const fs = require('fs').promises;
const path = require('path');
const process = require('process');
const {google} = require('googleapis');

// Reuse credentials path from the docs script
const CREDENTIALS_PATH = path.join(__dirname, '../../google-tasks/credentials.json');
const TOKEN_PATH = path.join(__dirname, 'token.json');

async function authorize() {
  const content = await fs.readFile(TOKEN_PATH);
  const credentials = JSON.parse(content);
  return google.auth.fromJSON(credentials);
}

async function searchAllFiles(auth, query) {
  const drive = google.drive({version: 'v3', auth});
  const res = await drive.files.list({
    q: `name contains '${query}'`,
    fields: 'files(id, name, mimeType)',
    spaces: 'drive',
  });
  const files = res.data.files;
  if (files.length === 0) {
    console.log('No files found.');
  } else {
    files.forEach(file => {
      console.log(`${file.name} (${file.id}) [${file.mimeType}]`);
    });
  }
}

async function main() {
  const query = process.argv[2] || '.note';
  const auth = await authorize();
  await searchAllFiles(auth, query);
}

main().catch(console.error);
