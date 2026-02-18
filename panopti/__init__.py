# panopti/__init__.py
from .viewer import connect, start_server
from .utils import *

__version__ = '0.3.0'
__all__ = ['connect', 'start_server', 'capture_prints']
