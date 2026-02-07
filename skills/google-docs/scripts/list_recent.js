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

async function listRecentFiles(auth) {
  const drive = google.drive({version: 'v3', auth});
  const res = await drive.files.list({
    pageSize: 20,
    fields: 'files(id, name, mimeType, modifiedTime)',
    orderBy: 'modifiedTime desc',
    spaces: 'drive',
  });
  const files = res.data.files;
  if (files.length === 0) {
    console.log('No files found.');
  } else {
    files.forEach(file => {
      console.log(`${file.modifiedTime} | ${file.name} (${file.id}) [${file.mimeType}]`);
    });
  }
}

async function main() {
  const auth = await loadSavedCredentialsIfExist();
  if (!auth) {
    console.error('No token found.');
    process.exit(1);
  }
  await listRecentFiles(auth);
}

main().catch(console.error);
