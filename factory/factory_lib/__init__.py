"""The software factory: turns a work order into a checked candidate change.

The controller is plain Python, not an AI. It decides who goes next (announcer.py), which
files an agent may touch (scope.py), which checks run on the exact candidate (gate.py), and
when time is up. The AI agents (agents.py) only write code, review it, and narrate.
See factory/README.md.
"""
