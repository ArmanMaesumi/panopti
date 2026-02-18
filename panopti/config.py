# panopti/config.py
import os
from typing import Dict, Any, Optional
try:
    from importlib.resources import files as importlib_files
except ImportError:
    try:
        from importlib_resources import files as importlib_files
    except ImportError:
        print("Error: importlib.resources (Python 3.9+) or importlib_resources (Python 3.8) is not installed")
import tomli

def merge_configs(user_config: Dict[str, Any], default_config: Dict[str, Any]) -> Dict[str, Any]:
    """
    Recursively merge user config with default config, ensuring all default fields are present.
    User config values override default values.
    """
    result = default_config.copy()
    
    if not user_config:
        return result
    
    for key, value in user_config.items():
        if key in result and isinstance(result[key], dict) and isinstance(value, dict):
            result[key] = merge_configs(value, result[key])
        else:
            result[key] = value
    
    return result

def load_config(config_path: Optional[str] = None) -> Dict[str, Any]:
    """
    Load configuration from a .panopti.toml file.
    
    Args:
        config_path: Path to the configuration file. If None, looks for .panopti.toml in current directory,
                    then falls back to the default bundled configuration.
    
    Returns:
        Dictionary containing the configuration merged with defaults
    """
    default_config = get_default_config()
    
    # Try to load user-provided config file
    if config_path and os.path.exists(config_path):
        print('Loading config from provided path', config_path)
        with open(config_path, 'rb') as f:
            user_config = tomli.load(f)
            return merge_configs(user_config, default_config)
    
    # Try to load .panopti.toml from current directory
    if os.path.exists('.panopti.toml'):
        print('Loading config from project directory')
        with open('.panopti.toml', 'rb') as f:
            user_config = tomli.load(f)
            return merge_configs(user_config, default_config)
    
    # Return default configuration if no user config found
    print('No user config found, using default')
    return default_config

def get_default_config() -> Dict[str, Any]:
    """Return the default configuration by loading from default_config.toml."""
    default_config_path = importlib_files('panopti') / 'default_config.toml'
    if os.path.exists(default_config_path):
        with open(default_config_path, 'rb') as f:
            return tomli.load(f)
    else:
        raise FileNotFoundError(f"Default config file not found at {default_config_path}") 