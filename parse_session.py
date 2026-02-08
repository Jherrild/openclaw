import sys, json

for line in open(sys.argv[1]):
    try:
        obj = json.loads(line.strip())
        if obj.get('type') != 'message':
            continue
        msg = obj.get('message', {})
        role = msg.get('role', '?')
        if role == 'assistant':
            parts = msg.get('content', [])
            if isinstance(parts, str):
                print(f'ASSISTANT: {parts[:500]}')
            elif isinstance(parts, list):
                for p in parts:
                    if isinstance(p, dict) and p.get('type') == 'text':
                        print(f'ASSISTANT: {p["text"][:500]}')
                    elif isinstance(p, dict) and p.get('type') == 'tool_use':
                        print(f'TOOL_CALL: {p.get("name","?")} -> {str(p.get("input",""))[:300]}')
        elif role == 'user':
            content = msg.get('content', '')
            if isinstance(content, str):
                print(f'USER: {content[:400]}')
            elif isinstance(content, list):
                for c in content:
                    if isinstance(c, dict) and c.get('type') == 'text':
                        print(f'USER: {c["text"][:400]}')
        elif role == 'tool':
            content = msg.get('content', '')
            if isinstance(content, list):
                for c in content:
                    if isinstance(c, dict):
                        print(f'TOOL_RESULT: {str(c.get("text",""))[:200]}')
            elif isinstance(content, str):
                print(f'TOOL_RESULT: {content[:200]}')
    except:
        pass
