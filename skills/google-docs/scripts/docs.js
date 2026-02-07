const fs = require('fs').promises;
const path = require('path');
const process = require('process');
const {google} = require('googleapis');

// Scopes for Google Docs and Google Drive (for searching/listing)
const SCOPES = [
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/drive.file'
];

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
    'http://localhost' 
  );

  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
  });

  console.log('Authorize this app by visiting this url:', authUrl);
  
  const code = process.argv.find(arg => arg.startsWith('--code='));
  if (!code) {
    console.log('Restart script with --code=YOUR_CODE_HERE');
    process.exit(0);
  }
  
  const {tokens} = await oAuth2Client.getToken(code.split('=')[1]);
  oAuth2Client.setCredentials(tokens);
  await saveCredentials(oAuth2Client);
  return oAuth2Client;
}

async function getDocument(auth, documentId) {
  const docs = google.docs({version: 'v1', auth});
  const res = await docs.documents.get({documentId});
  
  // Convert structural elements to simple text/markdown
  let text = '';
  res.data.body.content.forEach(element => {
    if (element.paragraph) {
      element.paragraph.elements.forEach(el => {
        if (el.textRun) {
          text += el.textRun.content;
        }
      });
    }
  });
  console.log(text);
}

async function createDocument(auth, title) {
  const docs = google.docs({version: 'v1', auth});
  const res = await docs.documents.create({
    requestBody: { title }
  });
  console.log(`Created document: ${res.data.title} (ID: ${res.data.documentId})`);
}

async function appendText(auth, documentId, text) {
  const docs = google.docs({version: 'v1', auth});
  const res = await docs.documents.batchUpdate({
    documentId,
    requestBody: {
      requests: [
        {
          insertText: {
            endOfSegmentLocation: { segmentId: '' }, // Append to end of body
            text: text + '\n'
          }
        }
      ]
    }
  });
  console.log(`Updated document ${documentId}`);
}

async function searchDocuments(auth, query) {
  const drive = google.drive({version: 'v3', auth});
  const res = await drive.files.list({
    q: `mimeType='application/vnd.google-apps.document' and name contains '${query}'`,
    fields: 'files(id, name)',
    spaces: 'drive',
  });
  const files = res.data.files;
  if (files.length === 0) {
    console.log('No documents found.');
  } else {
    files.forEach(file => {
      console.log(`${file.name} (${file.id})`);
    });
  }
}

async function main() {
  const command = process.argv[2];
  const auth = await authorize();
  
  if (command === 'get') {
    await getDocument(auth, process.argv[3]);
  } else if (command === 'create') {
    await createDocument(auth, process.argv[3]);
  } else if (command === 'search') {
    await searchDocuments(auth, process.argv[3]);
  } else if (command === 'append') {
    await appendText(auth, process.argv[3], process.argv[4]);
  } else {
    console.log('Usage: node docs.js [get <id> | create <title> | search <query> | append <id> <text>]');
  }
}

main().catch(console.error);
