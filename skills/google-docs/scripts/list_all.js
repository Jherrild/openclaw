const fs = require('fs').promises;
const path = require('path');
const process = require('process');
const {google} = require('googleapis');

const CREDENTIALS_PATH = path.join(__dirname, '../../google-tasks/credentials.json');
const TOKEN_PATH = path.join(__dirname, 'token.json');

async function loadSavedCredentialsIfExist() {
  try {
    const content = await fs.readFile(TOKEN_PATH);
    const credentials = JSON.parse(content);
    return google.auth.fromJSON(credentials);
  } catch (err) {
    return null;
  }
}

async function listEverything(auth) {
  const drive = google.drive({version: 'v3', auth});
  
  // 1. List Shared Drives
  console.log('--- Shared Drives ---');
  const drivesRes = await drive.drives.list();
  if (drivesRes.data.drives.length === 0) {
    console.log('No shared drives found.');
  } else {
    drivesRes.data.drives.forEach(d => console.log(`${d.name} (${d.id})`));
  }

  // 2. List Files (including shared with me and shared drives)
  console.log('\n--- Files (Top 50) ---');
  const filesRes = await drive.files.list({
    pageSize: 50,
    fields: 'files(id, name, mimeType, modifiedTime, shared, owners)',
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
    orderBy: 'modifiedTime desc'
  });
  
  const files = filesRes.data.files;
  if (!files || files.length === 0) {
    console.log('No files found.');
  } else {
    files.forEach(file => {
      const owner = file.owners ? file.owners[0].emailAddress : 'unknown';
      console.log(`${file.modifiedTime} | ${file.name} (${file.id}) | Owner: ${owner} | Shared: ${file.shared}`);
    });
  }
}

async function main() {
  const auth = await loadSavedCredentialsIfExist();
  if (!auth) {
    console.error('No token found.');
    process.exit(1);
  }
  await listEverything(auth);
}

main().catch(console.error);
