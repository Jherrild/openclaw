const fs = require('fs').promises;
const path = require('path');
const process = require('process');
const {authenticate} = require('@google-cloud/local-auth');
const {google} = require('googleapis');

// If modifying these scopes, delete token_calendar.json.
const SCOPES = ['https://www.googleapis.com/auth/calendar'];
const TOKEN_PATH = path.join(__dirname, 'token_calendar.json');
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

async function listEvents(auth) {
  const calendar = google.calendar({version: 'v3', auth});
  const res = await calendar.events.list({
    calendarId: 'primary',
    timeMin: new Date().toISOString(),
    maxResults: 10,
    singleEvents: true,
    orderBy: 'startTime',
  });
  const events = res.data.items;
  if (!events || events.length === 0) {
    console.log('No upcoming events found.');
    return;
  }
  console.log('Upcoming 10 events:');
  events.map((event, i) => {
    const start = event.start.dateTime || event.start.date;
    console.log(`${start} - ${event.summary}`);
  });
}

async function createEvent(auth, summary, startTime, durationMinutes, description) {
    const calendar = google.calendar({version: 'v3', auth});
    
    const start = new Date(startTime);
    const end = new Date(start.getTime() + durationMinutes * 60000);

    const event = {
        summary: summary,
        description: description,
        start: { dateTime: start.toISOString() },
        end: { dateTime: end.toISOString() },
        visibility: 'private',
    };

    try {
        const res = await calendar.events.insert({
            calendarId: 'primary',
            resource: event,
        });
        console.log(`Event created: ${res.data.htmlLink}`);
    } catch (err) {
        console.error('There was an error contacting the Calendar service: ' + err);
    }
}

async function updateEvent(auth, eventId, updates) {
    const calendar = google.calendar({version: 'v3', auth});
    try {
        const res = await calendar.events.patch({
            calendarId: 'primary',
            eventId: eventId,
            resource: updates,
        });
        console.log(`Event updated: ${res.data.htmlLink}`);
    } catch (err) {
        console.error('Error updating event: ' + err);
    }
}

async function main() {
  const command = process.argv[2];
  const client = await authorize();
  
  if (command === 'list') {
    await listEvents(client);
  } else if (command === 'add') {
    const summary = process.argv[3];
    const startTime = process.argv[4];
    const duration = parseInt(process.argv[5]) || 60;
    const description = process.argv[6] || '';
    await createEvent(client, summary, startTime, duration, description);
  } else if (command === 'update') {
    const eventId = process.argv[3];
    const description = process.argv[4];
    await updateEvent(client, eventId, { description, visibility: 'private' });
  } else {
    console.log('Usage: node calendar.js [list | add "Title" "ISO-Time" durationMins "Desc" | update id "Desc"] [--code=...]');
  }
}

main().catch(console.error);
