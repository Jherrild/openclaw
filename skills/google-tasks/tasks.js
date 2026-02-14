const fs = require('fs').promises;
const path = require('path');
const process = require('process');
const {authenticate} = require('@google-cloud/local-auth');
const {google} = require('googleapis');

// If modifying these scopes, delete token.json.
const SCOPES = ['https://www.googleapis.com/auth/tasks'];
const TOKEN_PATH = path.join(__dirname, 'token.json');
const CREDENTIALS_PATH = path.join(__dirname, 'credentials.json');

const PERSONAL_ID = 'MDk1NTEwMDE1MDAxMTI5NTQxNjQ6MDow'; 

async function loadSavedCredentialsIfExist() {
  try {
    const content = await fs.readFile(TOKEN_PATH);
    const credentials = JSON.parse(content);
    return google.auth.fromJSON(credentials);
  } catch (err) {
    return null;
  }
}

async function saveCredentials(client) {
  const content = await fs.readFile(CREDENTIALS_PATH);
  const keys = JSON.parse(content);
  const key = keys.installed || keys.web;
  const payload = JSON.stringify({
    type: 'authorized_user',
    client_id: key.client_id,
    client_secret: key.client_secret,
    refresh_token: client.credentials.refresh_token,
  });
  await fs.writeFile(TOKEN_PATH, payload);
}

async function authorize() {
  let client = await loadSavedCredentialsIfExist();
  if (client) {
    return client;
  }
  
  const content = await fs.readFile(CREDENTIALS_PATH);
  const keys = JSON.parse(content);
  const key = keys.installed || keys.web;
  
  const oAuth2Client = new google.auth.OAuth2(
    key.client_id,
    key.client_secret,
    key.redirect_uris[0]
  );

  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
  });

  const code = process.argv.find(arg => arg.startsWith('--code='));
  if (!code && !client) {
    console.log('Authorize this app by visiting this url:', authUrl);
    console.log('Restart script with --code=YOUR_CODE_HERE');
    process.exit(0);
  }
  
  if (code) {
    const {tokens} = await oAuth2Client.getToken(code.split('=')[1]);
    oAuth2Client.setCredentials(tokens);
    await saveCredentials(oAuth2Client);
    return oAuth2Client;
  }
}

async function listTaskLists(auth) {
  const service = google.tasks({version: 'v1', auth});
  const res = await service.tasklists.list();
  const lists = res.data.items;
  
  if (!lists || lists.length === 0) {
    console.log('No task lists found.');
    return;
  }
  
  console.log('Available Task Lists:');
  lists.forEach((list) => {
    console.log(`- ${list.title} (ID: ${list.id})`);
  });
}

async function listTasks(auth, listIdOrName) {
  const service = google.tasks({version: 'v1', auth});
  let listId = listIdOrName;

  if (!listId) {
     listId = PERSONAL_ID;
  }
  
  const res = await service.tasks.list({
    tasklist: listId,
    showCompleted: false,
    maxResults: 50,
  });
  
  const tasks = res.data.items;
  if (!tasks || tasks.length === 0) {
    console.log(`No tasks found in list ${listId}.`);
    return;
  }
  
  tasks.forEach((task) => {
    const notesInfo = task.notes ? ` | Notes: ${task.notes}` : '';
    console.log(`[${task.status === 'completed' ? 'x' : ' '}] ${task.title} (ID: ${task.id})${notesInfo}`);
  });
}

async function addTask(auth, title, listId, due, notes) {
  const service = google.tasks({version: 'v1', auth});
  const targetListId = listId || PERSONAL_ID;
  
  const requestBody = {
    title: title,
  };
  
  if (due) {
      requestBody.due = due;
  }
  
  if (notes) {
      requestBody.notes = notes;
  }
  
  const res = await service.tasks.insert({
    tasklist: targetListId,
    requestBody: requestBody,
  });
  console.log(`Task created: ${res.data.title} in list ${targetListId} (Due: ${due || 'None'})`);
}

async function completeTask(auth, taskId, listId) {
    const service = google.tasks({version: 'v1', auth});
    if (!listId) {
        console.log("Error: List ID required to complete task.");
        return;
    }

    await service.tasks.update({
        tasklist: listId,
        task: taskId,
        requestBody: {
            id: taskId,
            status: 'completed'
        }
    });
    console.log(`Task ${taskId} completed.`);
}

async function createTaskList(auth, title) {
  const service = google.tasks({version: 'v1', auth});
  const res = await service.tasklists.insert({
    requestBody: {
      title: title
    }
  });
  console.log(`Task List created: ${res.data.title} (ID: ${res.data.id})`);
}

async function deleteEmptyLists(auth) {
  const service = google.tasks({version: 'v1', auth});
  const res = await service.tasklists.list();
  const lists = res.data.items;
  
  if (!lists || lists.length === 0) return;
  
  console.log('Checking for empty lists...');
  for (const list of lists) {
    if (list.id === PERSONAL_ID) continue; 
    
    const taskRes = await service.tasks.list({
        tasklist: list.id,
        showCompleted: true,
        maxResults: 1
    });
    
    if (!taskRes.data.items || taskRes.data.items.length === 0) {
        console.log(`Deleting empty list: ${list.title} (${list.id})`);
        try {
            await service.tasklists.delete({tasklist: list.id});
        } catch (e) {
            console.error(`Failed to delete ${list.title}: ${e.message}`);
        }
    }
  }
}

async function moveTasks(auth, sourceListId, targetListId) {
  const service = google.tasks({version: 'v1', auth});
  
  const res = await service.tasks.list({
    tasklist: sourceListId,
    showCompleted: true, 
    maxResults: 100 
  });
  
  const tasks = res.data.items;
  if (!tasks || tasks.length === 0) {
    console.log(`No tasks to move from list ${sourceListId}.`);
    return;
  }
  
  console.log(`Moving ${tasks.length} tasks...`);
  
  for (const task of tasks) {
      try {
          if (!task.title) continue; 
          
          await service.tasks.insert({
              tasklist: targetListId,
              requestBody: {
                  title: task.title,
                  notes: task.notes,
                  due: task.due,
                  status: task.status
              }
          });
          
          await service.tasks.delete({
              tasklist: sourceListId,
              task: task.id
          });
          
          console.log(`Moved: ${task.title}`);
      } catch (e) {
          console.error(`Failed to move ${task.title}: ${e.message}`);
      }
  }
}

async function main() {
  const command = process.argv[2];
  const client = await authorize();
  
  if (command === 'lists') {
    await listTaskLists(client);
  } else if (command === 'create-list') {
    const title = process.argv[3];
    await createTaskList(client, title);
  } else if (command === 'cleanup') {
    await deleteEmptyLists(client);
  } else if (command === 'move-all') {
    const source = process.argv[3];
    const target = process.argv[4];
    await moveTasks(client, source, target);
  } else if (command === 'delete-list') {
    const listId = process.argv[3];
    const service = google.tasks({version: 'v1', auth: client});
    await service.tasklists.delete({tasklist: listId});
    console.log(`Deleted list ${listId}`);
  } else if (command === 'list') {
    const listId = process.argv[3];
    await listTasks(client, listId);
  } else if (command === 'add') {
    const title = process.argv[3];
    const listId = process.argv[4];
    const due = process.argv[5];
    const notes = process.argv[6];
    await addTask(client, title, listId, due, notes);
  } else if (command === 'add-base64') {
    const b64 = process.argv[3];
    const listId = process.argv[4];
    const due = process.argv[5];
    const b64Notes = process.argv[6];
    const title = Buffer.from(b64, 'base64').toString('utf8');
    const notes = b64Notes ? Buffer.from(b64Notes, 'base64').toString('utf8') : undefined;
    await addTask(client, title, listId, due, notes);
  } else if (command === 'add-file') {
    const filePath = process.argv[3];
    const listId = process.argv[4];
    const due = process.argv[5];
    let title;
    try {
        title = (await fs.readFile(filePath, 'utf8')).trim();
    } catch (e) {
        console.error(`Failed to read title file: ${e.message}`);
        process.exit(1);
    }
    await addTask(client, title, listId, due);
  } else if (command === 'complete') {
    const taskId = process.argv[3];
    const listId = process.argv[4];
    await completeTask(client, taskId, listId);
  } else {
    console.log('Usage: node tasks.js [lists | list <listId> | add <title> [listId] [due] [notes] | complete <taskId> <listId> | move-all <src> <dst> | delete-list <id>]');
    console.log('  Robust add:');
    console.log('    node tasks.js add-base64 <base64_title> [listId] [due] [base64_notes]');
    console.log('    node tasks.js add-file <filePath> [listId] [due]');
  }
}

main().catch(console.error);
