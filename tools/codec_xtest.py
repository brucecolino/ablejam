import sys, os, binascii
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "bridge", "AbleJam"))
import osc  # noqa: E402


def emit():
    msg = osc.encode("/ablejam/transport", [("i", 1), ("f", 154.5), ("i", 4), ("i", 4), ("i", 3)])
    addr, args = osc.decode(msg)  # self round-trip
    assert addr == "/ablejam/transport", addr
    assert args[0] == 1 and abs(args[1] - 154.5) < 1e-3 and args[2] == 4 and args[4] == 3, args
    sys.stdout.write(binascii.hexlify(msg).decode())


def decode(path):
    with open(path) as f:
        data = binascii.unhexlify(f.read().strip())
    addr, args = osc.decode(data)
    print("PY decode:", addr, args)
    assert addr == "/ablejam/cmd/jumpToSong", addr
    assert args[0] == 3, args
    print("PASS  python decoded the node-encoded command")


if __name__ == "__main__":
    if sys.argv[1] == "emit":
        emit()
    elif sys.argv[1] == "decode":
        decode(sys.argv[2])
