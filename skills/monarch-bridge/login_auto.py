import asyncio
import os
import sys
from monarchmoney import MonarchMoney, RequireMFAException

async def login():
    email = os.environ.get("MONARCH_EMAIL")
    password = os.environ.get("MONARCH_PASSWORD")
    
    if not email or not password:
        print("Error: MONARCH_EMAIL and MONARCH_PASSWORD env vars required")
        sys.exit(1)

    print(f"Attempting login for {email}...")
    mm = MonarchMoney()
    
    try:
        # Try login without MFA first
        await mm.login(email, password, save_session=False)
    except RequireMFAException:
        print("MFA Required.")
        # If we had a secret key, we could use it here.
        # But we don't have the TOTP secret in env, so we might get stuck if MFA is on.
        # The library supports mfa_secret_key in login() if we had it.
        print("Error: MFA is enabled but no TOTP secret provided.")
        sys.exit(1)
        
    # Save session
    session_file = "skills/monarch-bridge/.session"
    # Ensure directory exists
    os.makedirs(os.path.dirname(session_file), exist_ok=True)
    mm.save_session(session_file)
    print(f"Success! Session saved to {session_file}")

if __name__ == "__main__":
    asyncio.run(login())
