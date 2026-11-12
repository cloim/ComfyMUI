import sys

path = '/opt/conda/lib/python3.11/site-packages/torch/_library/infer_schema.py'
with open(path, 'r', encoding='utf-8') as f:
    c = f.read()

target = '        if annotation_type not in SUPPORTED_PARAM_TYPES.keys():'
replacement = """        import types as _types
        if isinstance(annotation_type, _types.GenericAlias):
            if annotation_type.__origin__ is list and len(annotation_type.__args__) == 1:
                annotation_type = typing.List[annotation_type.__args__[0]]
        if isinstance(annotation_type, _types.UnionType):
            non_none = [a for a in annotation_type.__args__ if a is not type(None)]
            if len(non_none) == 1 and type(None) in annotation_type.__args__:
                annotation_type = typing.Optional[non_none[0]]
        if annotation_type not in SUPPORTED_PARAM_TYPES.keys():"""

if target in c:
    with open(path, 'w', encoding='utf-8') as f:
        f.write(c.replace(target, replacement))
    print("[Patch] Successfully patched torch._library.infer_schema for PEP 585/604 compatibility")
else:
    print("[Patch] Target not found in infer_schema, skipping")
