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

async function listSupernoteFiles(auth) {
  const drive = google.drive({version: 'v3', auth});
  const DRIVE_FOLDER = "19NabfLOmVIvqNZmI0PJYOwSLcPUSiLkK";
  
  let allFiles = [];
  let pageToken = null;
  
  do {
    const res = await drive.files.list({
      q: `'${DRIVE_FOLDER}' in parents and name contains '.note'`,
      fields: 'nextPageToken, files(id, name, modifiedTime)',
      pageSize: 100,
      pageToken: pageToken || undefined,
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
    });
    
    const files = (res.data.files || []).filter(f => f.name.toLowerCase().endsWith('.note'));
    allFiles = allFiles.concat(files);
    pageToken = res.data.nextPageToken;
  } while (pageToken);
  
  console.log(JSON.stringify(allFiles));
}

async function main() {
  const auth = await loadSavedCredentialsIfExist();
  if (!auth) {
    process.exit(1);
  }
  await listSupernoteFiles(auth);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
