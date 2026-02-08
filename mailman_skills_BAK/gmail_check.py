import os
import json
import urllib.request
import urllib.parse

def get_access_token(client_id, client_secret, refresh_token):
    url = "https://oauth2.googleapis.com/token"
    data = urllib.parse.urlencode({
        "client_id": client_id,
        "client_secret": client_secret,
        "refresh_token": refresh_token,
        "grant_type": "refresh_token",
    }).encode("utf-8")
    
    req = urllib.request.Request(url, data=data)
    with urllib.request.urlopen(req) as f:
        return json.loads(f.read().decode("utf-8")).get("access_token")

def list_unread(access_token):
    url = "https://gmail.googleapis.com/gmail/v1/users/me/messages?q=is:unread"
    req = urllib.request.Request(url)
    req.add_header("Authorization", f"Bearer {access_token}")
    with urllib.request.urlopen(req) as f:
        return json.loads(f.read().decode("utf-8"))

def get_message(access_token, msg_id):
    url = f"https://gmail.googleapis.com/gmail/v1/users/me/messages/{msg_id}"
    req = urllib.request.Request(url)
    req.add_header("Authorization", f"Bearer {access_token}")
    with urllib.request.urlopen(req) as f:
        return json.loads(f.read().decode("utf-8"))

def main():
    token_path = "creds/token_gmail.json"
    if not os.path.exists(token_path):
        print("No credentials found.")
        return

    with open(token_path, "r") as f:
        creds = json.load(f)

    try:
        access_token = get_access_token(
            creds["client_id"], creds["client_secret"], creds["refresh_token"]
        )
    except Exception as e:
        print(f"Failed to get access token: {e}")
        return
    
    if not access_token:
        print("Failed to get access token.")
        return

    try:
        data = list_unread(access_token)
    except Exception as e:
        print(f"Failed to list messages: {e}")
        return

    messages = data.get("messages", [])
    
    if not messages:
        print("No unread emails")
        return

    for m in messages[:20]:
        try:
            msg_data = get_message(access_token, m["id"])
            headers = msg_data.get("payload", {}).get("headers", [])
            
            subject = next((h["value"] for h in headers if h["name"].lower() == "subject"), "(No Subject)")
            sender = next((h["value"] for h in headers if h["name"].lower() == "from"), "(Unknown Sender)")
            
            print(f"Sender: {sender}")
            print(f"Subject: {subject}")
            print("-" * 20)
        except Exception as e:
            continue

if __name__ == "__main__":
    main()
