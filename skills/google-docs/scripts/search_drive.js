const fs = require('fs').promises;
const path = require('path');
const process = require('process');
const {google} = require('googleapis');

// Reuse credentials from google-tasks to save setup time
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
  const auth = await loadSavedCredentialsIfExist();
  
  if (!auth) {
    console.error('No token found. Please run the original docs.js to authorize first.');
    process.exit(1);
  }

  // FORCE RE-AUTH if --reauth is passed
  if (process.argv.includes('--reauth')) {
    const content = await fs.readFile(CREDENTIALS_PATH);
    const keys = JSON.parse(content);
    const key = keys.installed || keys.web;
    
    const oAuth2Client = new google.auth.OAuth2(
      key.client_id,
      key.client_secret,
      'http://localhost' 
    );

    const authUrl = oAuth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: [
        'https://www.googleapis.com/auth/documents',
        'https://www.googleapis.com/auth/drive.readonly',
        'https://www.googleapis.com/auth/drive.metadata.readonly'
      ],
      prompt: 'consent' // Force consent screen to ensure scopes are granted
    });

    console.log('RE-AUTHORIZE by visiting this url:', authUrl);
    console.log('Restart script with --code=YOUR_CODE_HERE');
    process.exit(0);
  }

  await searchAllFiles(auth, query);
}

main().catch(console.error);
