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

async function listWithDates(auth) {
  const drive = google.drive({version: 'v3', auth});
  const res = await drive.files.list({
    q: "name contains '.note'",
    fields: 'files(id, name, modifiedTime)',
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
    orderBy: 'modifiedTime desc'
  });
  
  const files = res.data.files.filter(f => f.name.toLowerCase().endsWith('.note'));
  
  if (files.length === 0) {
    console.log('No files with .note extension found.');
  } else {
    files.forEach(file => {
      console.log(`${file.modifiedTime} | ${file.name} (${file.id})`);
    });
  }
}

async function main() {
  const auth = await loadSavedCredentialsIfExist();
  if (!auth) {
    console.error('No token found.');
    process.exit(1);
  }
  await listWithDates(auth);
}

main().catch(console.error);
