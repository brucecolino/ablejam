# Minimal OSC 1.0 codec + non-blocking UDP server, stdlib only.
# Mirrors packages/shared/src/osc.ts so both ends share the wire format.
# Runs inside Live's embedded Python (no pip dependencies).
from __future__ import absolute_import
import socket
import struct


def _pad(b):
    return b + b"\x00" * ((4 - (len(b) % 4)) % 4)


def _osc_string(s):
    return _pad(s.encode("utf-8") + b"\x00")


def encode(address, args):
    """args: list of raw values or (type, value) tuples where type in 'i','f','s'."""
    types = ","
    data = b""
    for a in args:
        if isinstance(a, tuple):
            t, v = a
        elif isinstance(a, bool):
            t, v = "i", (1 if a else 0)
        elif isinstance(a, int):
            t, v = "i", a
        elif isinstance(a, float):
            t, v = "f", a
        else:
            t, v = "s", a
        types += t
        if t == "i":
            data += struct.pack(">i", int(v))
        elif t == "f":
            data += struct.pack(">f", float(v))
        else:
            data += _osc_string(str(v))
    return _osc_string(address) + _osc_string(types) + data


def _read_string(buf, o):
    end = buf.find(b"\x00", o)
    if end == -1:
        end = len(buf)
    s = buf[o:end].decode("utf-8", "replace")
    nxt = end + 1
    nxt += (4 - (nxt % 4)) % 4
    return s, nxt


def decode(buf):
    address, o = _read_string(buf, 0)
    args = []
    if o < len(buf) and buf[o:o + 1] == b",":
        types, o = _read_string(buf, o)
        for t in types[1:]:
            if t == "i":
                args.append(struct.unpack(">i", buf[o:o + 4])[0]); o += 4
            elif t == "f":
                args.append(struct.unpack(">f", buf[o:o + 4])[0]); o += 4
            elif t == "s":
                s, o = _read_string(buf, o); args.append(s)
    return address, args


class OSCServer(object):
    def __init__(self, local_port, remote_addr):
        self._remote = remote_addr
        self._handlers = {}
        self._sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        self._sock.setblocking(False)
        # Allow immediate re-bind when the control surface is reloaded in Live.
        try:
            self._sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        except OSError:
            pass
        self._sock.bind(("0.0.0.0", local_port))

    def on(self, address, fn):
        self._handlers[address] = fn

    def send(self, address, args):
        try:
            self._sock.sendto(encode(address, args), self._remote)
        except OSError:
            pass

    def process(self):
        while True:
            try:
                data, _ = self._sock.recvfrom(65535)
            except (BlockingIOError, OSError):
                break
            try:
                address, args = decode(data)
            except Exception:
                continue
            fn = self._handlers.get(address)
            if fn is not None:
                try:
                    fn(args)
                except Exception:
                    pass

    def shutdown(self):
        try:
            self._sock.close()
        except OSError:
            pass
