const fs = require('fs').promises;
const path = require('path');
const process = require('process');
const {google} = require('googleapis');

const TOKEN_PATH = path.join(__dirname, '../google-docs/scripts/token.json');

async function loadSavedCredentialsIfExist() {
  try {
    const content = await fs.readFile(TOKEN_PATH);
    const credentials = JSON.parse(content);
    return google.auth.fromJSON(credentials);
  } catch (err) {
    return null;
  }
}

async function downloadFile(auth, fileId, destPath) {
  const drive = google.drive({version: 'v3', auth});
  const res = await drive.files.get(
    {fileId, alt: 'media'},
    {responseType: 'stream'}
  );
  
  return new Promise((resolve, reject) => {
    const writeStream = require('fs').createWriteStream(destPath);
    res.data
      .on('end', () => resolve())
      .on('error', err => reject(err))
      .pipe(writeStream);
  });
}

async function main() {
  const auth = await loadSavedCredentialsIfExist();
  const fileId = process.argv[2];
  const destPath = process.argv[3];
  if (!auth || !fileId || !destPath) process.exit(1);
  await downloadFile(auth, fileId, destPath);
}

main().catch(() => process.exit(1));
