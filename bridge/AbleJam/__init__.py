# AbleJam — Ableton Live control surface (MIDI Remote Script).
# Live calls create_instance() with the control surface c_instance.
from __future__ import absolute_import
from .ablejam import AbleJam


def create_instance(c_instance):
    return AbleJam(c_instance)
