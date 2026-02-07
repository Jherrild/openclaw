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

async function searchByExtension(auth) {
  const drive = google.drive({version: 'v3', auth});
  // Search for files that end in .note
  // Note: 'name contains' is a partial match. 
  // We'll get everything with '.note' in the name and filter for the extension in JS.
  const res = await drive.files.list({
    q: "name contains '.note'",
    fields: 'files(id, name, mimeType, size)',
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
  });
  
  const files = res.data.files.filter(f => f.name.toLowerCase().endsWith('.note'));
  
  if (files.length === 0) {
    console.log('No files with .note extension found.');
  } else {
    files.forEach(file => {
      console.log(`${file.name} (${file.id}) [${file.mimeType}] ${file.size || 0} bytes`);
    });
  }
}

async function main() {
  const auth = await loadSavedCredentialsIfExist();
  if (!auth) {
    console.error('No token found.');
    process.exit(1);
  }
  await searchByExtension(auth);
}

main().catch(console.error);
