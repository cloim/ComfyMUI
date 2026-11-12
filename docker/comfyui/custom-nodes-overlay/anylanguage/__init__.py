from .anylanguage import AnyLanguage

NODE_CLASS_MAPPINGS = { 
    "AnyLanguage": AnyLanguage 
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "AnyLanguage": "Multilanguage Prompt Translation"
}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS"]