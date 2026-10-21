import sys
import os
import subprocess
import signal
import time
import threading

ROOT_DIR = os.path.dirname(os.path.abspath(__file__))
PID_FILE = os.path.join(ROOT_DIR, "data", "webirc.pid")
LOG_DIR = os.path.join(ROOT_DIR, "data", "logs")

_VENV_PY = os.path.join(ROOT_DIR, ".venv", "bin", "python")
if (os.path.exists(_VENV_PY) and os.access(_VENV_PY, os.X_OK) and
        os.path.realpath(sys.executable) != os.path.realpath(_VENV_PY)):
    os.execv(_VENV_PY, [_VENV_PY] + sys.argv)


def runtime_python():
    venv_py = os.path.join(ROOT_DIR, ".venv", "bin", "python")
    if os.path.exists(venv_py) and os.access(venv_py, os.X_OK):
        return venv_py
    return sys.executable

def get_pids():
    if not os.path.exists(PID_FILE):
        return []
    with open(PID_FILE, "r") as f:
        pids = []
        for line in f:
            line = line.strip()
            if line:
                try:
                    pids.append(int(line))
                except ValueError:
                    pass
        return pids

def is_running(pid):
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except OSError:
        return False

def start():
    active = [p for p in get_pids() if is_running(p)]
    if active:
        print(f"WebIRC is already running (PIDs: {', '.join(map(str, active))}).")
        return
    if os.path.exists(PID_FILE):
        print("Cleaning up stale PID file...")
        os.remove(PID_FILE)

    print("Starting WebIRC in the background...")
    os.makedirs(LOG_DIR, exist_ok=True)
    py_exec = runtime_python()
    
    kwargs = {}
    if sys.platform != "win32":
        kwargs["start_new_session"] = True

    with open(os.path.join(LOG_DIR, "web.log"), "a") as web_log, \
         open(os.path.join(LOG_DIR, "bouncer.log"), "a") as bouncer_log:
        web_proc = subprocess.Popen(
            [py_exec, "web.py"], cwd=ROOT_DIR,
            stdout=web_log, stderr=subprocess.STDOUT, **kwargs
        )
        bouncer_proc = subprocess.Popen(
            [py_exec, "bouncer.py"], cwd=ROOT_DIR,
            stdout=bouncer_log, stderr=subprocess.STDOUT, **kwargs
        )
    
    with open(PID_FILE, "w") as f:
        f.write(f"{web_proc.pid}\n{bouncer_proc.pid}\n")
        
    print(f"WebIRC started successfully!")
    print(f"Web PID: {web_proc.pid} | Bouncer PID: {bouncer_proc.pid}")
    print("Web logs: data/logs/web.log | Bouncer logs: data/logs/bouncer.log")

def stop():
    pids = get_pids()
    if not pids:
        print("WebIRC is not running (no PID file).")
        return
    
    print("Stopping WebIRC...")
    active_pids = [pid for pid in pids if is_running(pid)]
    
    for pid in active_pids:
        try:
            os.kill(pid, signal.SIGTERM)
            print(f"Sent SIGTERM to process {pid}")
        except OSError as e:
            print(f"Failed to signal process {pid}: {e}")

    if active_pids:
        print("Waiting for processes to exit...")
        for _ in range(50):
            time.sleep(0.1)
            active_pids = [pid for pid in active_pids if is_running(pid)]
            if not active_pids:
                break
        
        for pid in active_pids:
            try:
                print(f"Process {pid} still running, sending SIGKILL...")
                os.kill(pid, signal.SIGKILL)
            except OSError:
                pass
    
    if os.path.exists(PID_FILE):
        os.remove(PID_FILE)
    print("WebIRC stopped.")

def status():
    pids = get_pids()
    if not pids:
        print("WebIRC is NOT running.")
        return
    
    active = [p for p in pids if is_running(p)]
    if len(active) == len(pids) and pids:
        print(f"WebIRC is RUNNING (PIDs: {', '.join(map(str, active))})")
    elif active:
        print(f"WebIRC is PARTIALLY RUNNING (Active PIDs: {', '.join(map(str, active))})")
    else:
        print("WebIRC is NOT running (stale PID file found).")

def restart():
    stop()
    time.sleep(1)
    start()

def debug():
    active = [p for p in get_pids() if is_running(p)]
    if active:
        print(f"WebIRC is already running (PIDs: {', '.join(map(str, active))}). Stop it first.")
        return

    print("Starting WebIRC in DEBUG mode (foreground) — Ctrl+C to stop.")
    print("=" * 60)
    py_exec = runtime_python()

    web_proc = subprocess.Popen(
        [py_exec, "-u", "web.py"],
        cwd=ROOT_DIR,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT
    )
    bouncer_proc = subprocess.Popen(
        [py_exec, "-u", "bouncer.py", "--debug"],
        cwd=ROOT_DIR,
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT
    )

    def _stream(prefix, proc):
        for raw_line in iter(proc.stdout.readline, b''):
            sys.stdout.write(f"[{prefix}] {raw_line.decode('utf-8', errors='replace').rstrip()}\n")
            sys.stdout.flush()

    threading.Thread(target=_stream, args=("WEB", web_proc), daemon=True).start()
    threading.Thread(target=_stream, args=("BNC", bouncer_proc), daemon=True).start()

    try:
        while True:
            if web_proc.poll() is not None:
                print(f"[WEB] Process exited (code {web_proc.returncode})")
                break
            if bouncer_proc.poll() is not None:
                print(f"[BNC] Process exited (code {bouncer_proc.returncode})")
                break
            time.sleep(0.1)
    except KeyboardInterrupt:
        print("\nDebug session interrupted. Stopping...")
    finally:
        for proc in (web_proc, bouncer_proc):
            if proc.poll() is None:
                proc.terminate()
        web_proc.wait()
        bouncer_proc.wait()
    print("Debug session ended.")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python main.py [start|stop|restart|status|debug]")
        sys.exit(1)
        
    cmd = sys.argv[1].lower()
    if cmd == "start":
        start()
    elif cmd == "stop":
        stop()
    elif cmd == "restart":
        restart()
    elif cmd == "status":
        status()
    elif cmd == "debug":
        debug()
    else:
        print(f"Unknown command: {cmd}")
        print("Usage: python main.py [start|stop|restart|status|debug]")
        sys.exit(1)
