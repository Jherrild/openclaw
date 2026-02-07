const fs = require('fs').promises;
const path = require('path');
const process = require('process');
const {google} = require('googleapis');

// If modifying these scopes, delete token_gmail.json.
const SCOPES = ['https://www.googleapis.com/auth/gmail.readonly'];
const TOKEN_PATH = path.join(__dirname, 'token_gmail.json');
const CREDENTIALS_PATH = path.join(__dirname, 'credentials.json');

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

async function listUnreadSubjects(auth) {
  const gmail = google.gmail({version: 'v1', auth});
  const res = await gmail.users.messages.list({
    userId: 'me',
    q: 'is:unread',
    maxResults: 20,
  });
  
  const messages = res.data.messages;
  if (!messages || messages.length === 0) {
    console.log('No unread messages.');
    return;
  }

  for (const message of messages) {
    const msg = await gmail.users.messages.get({
      userId: 'me',
      id: message.id,
    });
    
    const headers = msg.data.payload.headers;
    const subject = headers.find(h => h.name === 'Subject')?.value || '(No Subject)';
    const from = headers.find(h => h.name === 'From')?.value || '(Unknown Sender)';
    
    console.log(`[${message.id}] FROM: ${from} | SUBJECT: ${subject}`);
  }
}

async function getMessageDetails(auth, messageId) {
    const gmail = google.gmail({ version: 'v1', auth });
    const msg = await gmail.users.messages.get({
        userId: 'me',
        id: messageId,
        format: 'full'
    });
    
    const headers = msg.data.payload.headers;
    const listUnsubscribe = headers.find(h => h.name === 'List-Unsubscribe')?.value;
    
    // Simple body extraction
    let body = "";
    if (msg.data.payload.parts) {
        body = msg.data.payload.parts.map(p => p.body.data ? Buffer.from(p.body.data, 'base64').toString() : "").join("\n");
    } else if (msg.data.payload.body.data) {
        body = Buffer.from(msg.data.payload.body.data, 'base64').toString();
    }

    return {
        id: messageId,
        from: headers.find(h => h.name === 'From')?.value,
        subject: headers.find(h => h.name === 'Subject')?.value,
        listUnsubscribe,
        body
    };
}

async function main() {
  const command = process.argv[2];
  const client = await authorize();
  
  if (command === 'scan') {
    await listUnreadSubjects(client);
  } else if (command === 'details') {
    const id = process.argv[3];
    const details = await getMessageDetails(client, id);
    console.log(JSON.stringify(details, null, 2));
  } else {
    console.log('Usage: node gmail.js [scan | details <id>] [--code=...]');
  }
}

main().catch(console.error);
