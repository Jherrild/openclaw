#!/usr/bin/env node
// orchestrator.js — CLI for managing systemd-backed scheduled tasks.
// Usage: orchestrator.js <command> [options]
// Commands: add, remove, list, run, status, logs, enable, disable

const fs = require('fs');
const path = require('path');
const { execSync, spawnSync } = require('child_process');
const os = require('os');

// ── Configuration ──────────────────────────────────────────────────────────────

const SKILL_DIR = __dirname;
const TASKS_FILE = path.join(SKILL_DIR, 'tasks.json');
const TEMPLATES_DIR = path.join(SKILL_DIR, 'templates');
const SYSTEMD_USER_DIR = path.join(os.homedir(), '.config', 'systemd', 'user');
const SERVICE_PREFIX = 'openclaw-task-';

// ── Helpers ────────────────────────────────────────────────────────────────────

function log(level, ...args) {
  const ts = new Date().toISOString();
  console[level === 'error' ? 'error' : 'log'](`[${ts}] [orchestrator] [${level}]`, ...args);
}

function loadTasks() {
  try {
    return JSON.parse(fs.readFileSync(TASKS_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveTasks(tasks) {
  fs.writeFileSync(TASKS_FILE, JSON.stringify(tasks, null, 2) + '\n');
}

function systemctl(args, throwOnError = false) {
  const result = spawnSync('systemctl', ['--user', ...args], {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  if (throwOnError && result.status !== 0) {
    throw new Error(`systemctl ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  }
  return {
    success: result.status === 0,
    stdout: (result.stdout || '').trim(),
    stderr: (result.stderr || '').trim(),
  };
}

function journalctl(unit, lines = 50) {
  const result = spawnSync('journalctl', ['--user', '-u', unit, '-n', String(lines), '--no-pager'], {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return (result.stdout || '').trim();
}

function unitName(taskName) {
  return `${SERVICE_PREFIX}${taskName}`;
}

function parseInterval(interval) {
  // Parse interval like "30m", "1h", "45min", "2h30m" into systemd format
  const clean = interval.toLowerCase().trim();
  // Systemd accepts: s, m, h, d, w, usec, msec, sec, min, hr, etc.
  // Just pass through if it looks valid
  if (/^\d+[smhdw]?$/i.test(clean)) return clean;
  if (/^\d+(sec|min|hr|day|week)/i.test(clean)) return clean;
  // Try to convert common formats
  const match = clean.match(/^(\d+)(m|min|minute|h|hr|hour|d|day|s|sec|second)s?$/i);
  if (match) {
    const num = match[1];
    const unit = match[2][0].toLowerCase();
    return `${num}${unit}`;
  }
  return clean; // Let systemd handle it
}

// ── Template Processing ────────────────────────────────────────────────────────

function loadTemplate(name) {
  return fs.readFileSync(path.join(TEMPLATES_DIR, name), 'utf8');
}

function renderTemplate(template, vars) {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
  }
  return result;
}

// ── Commands ───────────────────────────────────────────────────────────────────

function cmdAdd(args) {
  const usage = `Usage: orchestrator.js add <name> <script> [--interval=30m] [--args="..."]
  
Options:
  --interval=<time>       Timer interval (default: 30m). Examples: 30m, 1h, 2h, 45min
  --args="..."            Arguments to pass to the script
  --working-dir=...       Working directory for the script (default: script's directory)
  --node-path=...         NODE_PATH environment variable for the script
  --interrupt="..."       Enable interrupt on stdout. Format: "level: instruction"
                          (e.g. --interrupt="alert: Read .agent-pending for manifest.")
  --interrupt-file=...    Same as --interrupt but reads config from a file at trigger time.
                          Mutually exclusive with --interrupt.`;

  if (args.length < 2) {
    console.log(usage);
    process.exit(1);
  }

  const taskName = args[0];
  const scriptPath = path.resolve(args[1]);

  if (!fs.existsSync(scriptPath)) {
    log('error', `Script not found: ${scriptPath}`);
    process.exit(1);
  }

  // Parse options
  let interval = '30m';
  let scriptArgs = '';
  let workingDir = path.dirname(scriptPath);
  let nodePath = '';
  let interrupt = null;
  let interruptFile = null;

  for (let i = 2; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--interval=')) {
      interval = parseInterval(arg.split('=')[1]);
    } else if (arg.startsWith('--args=')) {
      scriptArgs = arg.split('=').slice(1).join('=');
    } else if (arg.startsWith('--working-dir=')) {
      workingDir = path.resolve(arg.split('=').slice(1).join('='));
    } else if (arg.startsWith('--node-path=')) {
      nodePath = arg.split('=').slice(1).join('=');
    } else if (arg.startsWith('--interrupt=')) {
      interrupt = arg.split('=').slice(1).join('=');
    } else if (arg.startsWith('--interrupt-file=')) {
      interruptFile = path.resolve(arg.split('=').slice(1).join('='));
    }
  }

  // Validate mutual exclusivity
  if (interrupt && interruptFile) {
    log('error', '--interrupt and --interrupt-file are mutually exclusive. Use one or the other.');
    process.exit(1);
  }

  // Validate interrupt-file exists
  if (interruptFile && !fs.existsSync(interruptFile)) {
    log('error', `Interrupt file not found: ${interruptFile}`);
    process.exit(1);
  }

  const tasks = loadTasks();
  if (tasks[taskName]) {
    log('error', `Task '${taskName}' already exists. Remove it first or use a different name.`);
    process.exit(1);
  }

  // Ensure systemd user directory exists
  fs.mkdirSync(SYSTEMD_USER_DIR, { recursive: true });

  const unit = unitName(taskName);
  const serviceFile = path.join(SYSTEMD_USER_DIR, `${unit}.service`);
  const timerFile = path.join(SYSTEMD_USER_DIR, `${unit}.timer`);

  // Determine exec command based on script type
  let execStart;
  if (scriptPath.endsWith('.sh')) {
    execStart = `/bin/bash ${scriptPath}`;
  } else if (scriptPath.endsWith('.js')) {
    execStart = `/usr/bin/env node ${scriptPath}`;
  } else {
    execStart = scriptPath;
  }
  if (scriptArgs) {
    execStart += ` ${scriptArgs}`;
  }

  // Wrap with interrupt-wrapper.sh if interrupt is configured
  const hasInterrupt = interrupt || interruptFile;
  if (hasInterrupt) {
    const wrapperPath = path.join(SKILL_DIR, 'interrupt-wrapper.sh');
    const mode = interruptFile ? 'file' : 'inline';
    const value = interruptFile || interrupt;
    // The wrapper takes: <task-name> <mode> <value> <script> [args...]
    execStart = `/bin/bash ${wrapperPath} ${taskName} ${mode} '${value.replace(/'/g, "'\\''")}' ${scriptPath}`;
    if (scriptArgs) {
      execStart += ` ${scriptArgs}`;
    }
  }

  // Render templates
  const serviceContent = renderTemplate(loadTemplate('task.service.template'), {
    TASK_NAME: taskName,
    EXEC_START: execStart,
    WORKING_DIR: workingDir,
    HOME: os.homedir(),
    NODE_PATH: nodePath || path.join(os.homedir(), '.openclaw/workspace/skills/google-tasks/node_modules'),
  });

  const timerContent = renderTemplate(loadTemplate('task.timer.template'), {
    TASK_NAME: taskName,
    INTERVAL: interval,
  });

  // Write unit files
  fs.writeFileSync(serviceFile, serviceContent);
  fs.writeFileSync(timerFile, timerContent);
  log('info', `Created ${serviceFile}`);
  log('info', `Created ${timerFile}`);

  // Reload systemd
  systemctl(['daemon-reload'], true);

  // Enable and start timer
  systemctl(['enable', `${unit}.timer`], true);
  systemctl(['start', `${unit}.timer`], true);
  log('info', `Enabled and started timer: ${unit}.timer`);

  // Save task metadata
  tasks[taskName] = {
    name: taskName,
    script: scriptPath,
    interval,
    args: scriptArgs,
    workingDir,
    nodePath: nodePath || '',
    interrupt: interrupt || null,
    interruptFile: interruptFile || null,
    unit,
    createdAt: new Date().toISOString(),
    enabled: true,
  };
  saveTasks(tasks);

  console.log(`\n✓ Task '${taskName}' added and started.`);
  console.log(`  Script: ${scriptPath}`);
  console.log(`  Interval: ${interval}`);
  if (interrupt) console.log(`  Interrupt: ${interrupt}`);
  if (interruptFile) console.log(`  Interrupt file: ${interruptFile}`);
  console.log(`  Timer: ${unit}.timer`);
  console.log(`\nView logs: orchestrator.js logs ${taskName}`);
  console.log(`Run now:   orchestrator.js run ${taskName}`);
}

function cmdRemove(args) {
  if (args.length < 1) {
    console.log('Usage: orchestrator.js remove <name>');
    process.exit(1);
  }

  const taskName = args[0];
  const tasks = loadTasks();

  if (!tasks[taskName]) {
    log('error', `Task '${taskName}' not found.`);
    process.exit(1);
  }

  const unit = unitName(taskName);
  const serviceFile = path.join(SYSTEMD_USER_DIR, `${unit}.service`);
  const timerFile = path.join(SYSTEMD_USER_DIR, `${unit}.timer`);

  // Stop and disable
  systemctl(['stop', `${unit}.timer`]);
  systemctl(['disable', `${unit}.timer`]);
  systemctl(['stop', `${unit}.service`]);
  systemctl(['disable', `${unit}.service`]);

  // Remove unit files
  if (fs.existsSync(serviceFile)) {
    fs.unlinkSync(serviceFile);
    log('info', `Removed ${serviceFile}`);
  }
  if (fs.existsSync(timerFile)) {
    fs.unlinkSync(timerFile);
    log('info', `Removed ${timerFile}`);
  }

  // Reload systemd
  systemctl(['daemon-reload']);

  // Remove from tasks.json
  delete tasks[taskName];
  saveTasks(tasks);

  console.log(`\n✓ Task '${taskName}' removed.`);
}

function cmdList() {
  const tasks = loadTasks();
  const taskNames = Object.keys(tasks);

  if (taskNames.length === 0) {
    console.log('No tasks registered.');
    return;
  }

  console.log('\nManaged Tasks:\n');
  console.log('  Name              Status      Interval   Next Run');
  console.log('  ────────────────  ──────────  ─────────  ────────────────────');

  for (const name of taskNames.sort()) {
    const task = tasks[name];
    const unit = unitName(name);

    // Get timer status
    const timerStatus = systemctl(['is-active', `${unit}.timer`]);
    const status = timerStatus.success ? 'active' : 'inactive';

    // Get next run time
    let nextRun = 'N/A';
    const listTimers = systemctl(['list-timers', '--all', `${unit}.timer`]);
    if (listTimers.success && listTimers.stdout) {
      const lines = listTimers.stdout.split('\n');
      for (const line of lines) {
        if (line.includes(unit)) {
          // Parse the timer output line
          const match = line.match(/(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/);
          if (match) {
            nextRun = match[1].substring(5); // Strip year for brevity
          }
          break;
        }
      }
    }

    const paddedName = name.padEnd(16);
    const paddedStatus = status.padEnd(10);
    const paddedInterval = task.interval.padEnd(9);
    console.log(`  ${paddedName}  ${paddedStatus}  ${paddedInterval}  ${nextRun}`);
  }

  console.log('');
}

function cmdRun(args) {
  if (args.length < 1) {
    console.log('Usage: orchestrator.js run <name>');
    process.exit(1);
  }

  const taskName = args[0];
  const tasks = loadTasks();

  if (!tasks[taskName]) {
    log('error', `Task '${taskName}' not found.`);
    process.exit(1);
  }

  const unit = unitName(taskName);
  console.log(`Running task '${taskName}'...`);

  const result = systemctl(['start', `${unit}.service`]);
  if (!result.success) {
    log('error', `Failed to start service: ${result.stderr}`);
    process.exit(1);
  }

  console.log(`✓ Task '${taskName}' triggered.`);
  console.log(`\nView output: orchestrator.js logs ${taskName}`);
}

function cmdStatus(args) {
  if (args.length < 1) {
    console.log('Usage: orchestrator.js status <name>');
    process.exit(1);
  }

  const taskName = args[0];
  const tasks = loadTasks();

  if (!tasks[taskName]) {
    log('error', `Task '${taskName}' not found.`);
    process.exit(1);
  }

  const task = tasks[taskName];
  const unit = unitName(taskName);

  console.log(`\nTask: ${taskName}`);
  console.log(`─────────────────────────────────────`);
  console.log(`Script:     ${task.script}`);
  console.log(`Interval:   ${task.interval}`);
  console.log(`Created:    ${task.createdAt}`);

  // Service status
  const serviceStatus = systemctl(['status', `${unit}.service`]);
  console.log(`\nService Status:`);
  if (serviceStatus.stdout) {
    // Extract relevant lines
    const lines = serviceStatus.stdout.split('\n');
    for (const line of lines) {
      if (line.includes('Active:') || line.includes('Main PID:') || line.includes('Tasks:') || line.includes('Memory:')) {
        console.log(`  ${line.trim()}`);
      }
    }
  }

  // Timer status
  const timerList = systemctl(['list-timers', '--all', `${unit}.timer`]);
  console.log(`\nTimer Status:`);
  if (timerList.stdout) {
    const lines = timerList.stdout.split('\n');
    for (const line of lines) {
      if (line.includes(unit) || line.includes('NEXT') || line.includes('LAST')) {
        console.log(`  ${line}`);
      }
    }
  }

  console.log('');
}

function cmdLogs(args) {
  const taskName = args[0];
  const lines = parseInt(args[1]) || 50;

  if (!taskName) {
    console.log('Usage: orchestrator.js logs <name> [lines]');
    process.exit(1);
  }

  const tasks = loadTasks();
  if (!tasks[taskName]) {
    log('error', `Task '${taskName}' not found.`);
    process.exit(1);
  }

  const unit = unitName(taskName);
  const output = journalctl(`${unit}.service`, lines);

  console.log(`\nLogs for '${taskName}' (last ${lines} lines):`);
  console.log('─'.repeat(60));
  console.log(output || '(no logs)');
  console.log('');
}

function cmdEnable(args) {
  if (args.length < 1) {
    console.log('Usage: orchestrator.js enable <name>');
    process.exit(1);
  }

  const taskName = args[0];
  const tasks = loadTasks();

  if (!tasks[taskName]) {
    log('error', `Task '${taskName}' not found.`);
    process.exit(1);
  }

  const unit = unitName(taskName);
  systemctl(['enable', `${unit}.timer`], true);
  systemctl(['start', `${unit}.timer`], true);

  tasks[taskName].enabled = true;
  saveTasks(tasks);

  console.log(`✓ Task '${taskName}' enabled.`);
}

function cmdDisable(args) {
  if (args.length < 1) {
    console.log('Usage: orchestrator.js disable <name>');
    process.exit(1);
  }

  const taskName = args[0];
  const tasks = loadTasks();

  if (!tasks[taskName]) {
    log('error', `Task '${taskName}' not found.`);
    process.exit(1);
  }

  const unit = unitName(taskName);
  systemctl(['stop', `${unit}.timer`]);
  systemctl(['disable', `${unit}.timer`]);

  tasks[taskName].enabled = false;
  saveTasks(tasks);

  console.log(`✓ Task '${taskName}' disabled.`);
}

function cmdHelp() {
  console.log(`
orchestrator.js — Systemd-backed task scheduler for OpenClaw

Usage: orchestrator.js <command> [arguments]

Commands:
  add <name> <script> [options]   Add a new scheduled task
    --interval=<time>             Timer interval (default: 30m)
    --args="..."                  Arguments to pass to the script
    --working-dir=<path>          Working directory
    --node-path=<path>            NODE_PATH environment
    --interrupt="level: text"     Fire interrupt when script outputs to stdout
    --interrupt-file=<path>       Same, but reads config from file at trigger time

  remove <name>                   Remove a task and its systemd units
  list                            List all managed tasks
  run <name>                      Manually trigger a task
  status <name>                   Show detailed task status
  logs <name> [lines]             Show task logs from journalctl
  enable <name>                   Enable a disabled task's timer
  disable <name>                  Disable a task's timer (keeps config)
  help                            Show this help message

Interrupt Contract:
  When --interrupt or --interrupt-file is set, the script is wrapped.
  - Exit 0 + stdout has content → fire interrupt with stdout as message
  - Exit 0 + no stdout          → stay silent (nothing happened)
  - Exit non-zero               → script failed, no interrupt fired

Examples:
  orchestrator.js add supernote-sync ./check-and-sync.sh --interval=10m \\
    --interrupt="alert: Read .agent-pending for manifest. File new notes via obsidian-scribe."
  orchestrator.js add my-monitor ./check.sh --interval=5m \\
    --interrupt-file=./interrupt-config.txt
  orchestrator.js list
  orchestrator.js run supernote-sync
  orchestrator.js logs supernote-sync 100
  orchestrator.js remove supernote-sync
`);
}

// ── Main ───────────────────────────────────────────────────────────────────────

const [, , command, ...args] = process.argv;

switch (command) {
  case 'add':
    cmdAdd(args);
    break;
  case 'remove':
  case 'rm':
    cmdRemove(args);
    break;
  case 'list':
  case 'ls':
    cmdList();
    break;
  case 'run':
  case 'trigger':
    cmdRun(args);
    break;
  case 'status':
    cmdStatus(args);
    break;
  case 'logs':
  case 'log':
    cmdLogs(args);
    break;
  case 'enable':
    cmdEnable(args);
    break;
  case 'disable':
    cmdDisable(args);
    break;
  case 'help':
  case '--help':
  case '-h':
  case undefined:
    cmdHelp();
    break;
  default:
    console.error(`Unknown command: ${command}`);
    cmdHelp();
    process.exit(1);
}
