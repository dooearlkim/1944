#!/usr/bin/env python3
"""SKY ACE 1944 dev server.
Serves this folder on 0.0.0.0 so phones on the same Wi-Fi can connect,
and prints the LAN address(es) to open on your phone.
Usage:  python3 serve.py [port]      (default port 8000)
"""
import http.server, os, socket, socketserver, sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
os.chdir(os.path.dirname(os.path.abspath(__file__)))

def lan_ips():
    ips = set()
    try:  # the interface used for the default route (no packet is actually sent)
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80)); ips.add(s.getsockname()[0]); s.close()
    except OSError:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ips.add(info[4][0])
    except OSError:
        pass
    return sorted(ip for ip in ips if not ip.startswith("127."))

class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")   # always get the latest build while developing
        super().end_headers()
    def log_message(self, fmt, *args):
        sys.stderr.write("  %s  %s\n" % (self.address_string(), fmt % args))

socketserver.TCPServer.allow_reuse_address = True
with socketserver.ThreadingTCPServer(("0.0.0.0", PORT), Handler) as httpd:
    print("\n  SKY ACE 1944 dev server running\n")
    print("  PC      : http://localhost:%d" % PORT)
    ips = lan_ips()
    for ip in ips:
        print("  Phone   : http://%s:%d   <- open this on your phone (same Wi-Fi)" % (ip, PORT))
    if not ips:
        print("  (Could not detect LAN IP - check ipconfig / ifconfig)")
    print("\n  Ctrl+C to stop\n")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n  bye!")
