# WebIRC Client Setup Guide

WebIRC is a two-part application: a Python backend "bouncer" that connects to IRC networks and manages message history, and a lightweight web frontend. 

## 1. Prerequisites
- Python 3.x
- `asyncio` and `websockets` libraries. Install them via terminal:
  ```bash
  pip install websockets
  ```

## 2. Configuration (`data/networks.json`)
By default, the client configuration and your personalized network list live in `data/networks.json`:
- **identity**: Set your default `nick`, `username`, and `realname`. 
- **networks**: Add any IRC networks you want to connect to. In `bouncer` mode the daemon connects immediately and logs channels history. In `direct` mode the network only connects when you click "Connect" in the UI. 
- **auth**: If you want to password protect your WebIRC dashboard from the open internet, set `"enabled": true` and configure a `"username"` and `"password"`.

## 3. Running WebIRC
To easily manage the application, run the `main.py` daemon control script. It spawns the backend and frontend simultaneously in the background inside your current session:
```bash
python main.py start
```

You can view the active state or safely kill the servers using the other commands:
```bash
python main.py status
python main.py restart
python main.py stop
```

## 4. Accessing the Client
Open your web browser and navigate to:
```text
http://localhost:8080
```
(Or whatever IP address your server is hosted on in place of `localhost`). 
If you enabled authentication in `networks.json`, you will be prompted to log in!
