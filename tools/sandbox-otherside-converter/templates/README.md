# Otherside skeleton templates

- `ODK_Base_Skeleton.fbx` is the official Otherside Developer Kit base skeleton, downloaded from the [ODK custom character docs](https://docs.otherside.xyz/odk-docs/characters/creating-a-custom-character). Attribution: Yuga Labs / Otherside Developer Kit. Import it into Blender and **Apply All Transforms** before binding (the docs call this out because FBX units/axes differ from Blender).
- `ODK_Sandbox_Compare.blend` is generated locally:

```bash
python app.py build-template
```

That file is not committed. The build script imports the official FBX when present, otherwise rebuilds a UE5-named armature from `config/odk_bones.json`, then adds rigidly bound placeholder cubes and a 1.0 / 1.8 / 2.0 m height ruler.

Overlay a Sandbox avatar on the right/left for comparison:

```bash
python app.py build-template --overlay /path/to/sandbox-avatar.gltf
```
