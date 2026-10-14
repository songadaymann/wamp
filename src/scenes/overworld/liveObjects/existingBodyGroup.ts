import Phaser from 'phaser';

/** Group existing bodies for spatial queries without applying new-body defaults. */
export function createExistingBodyGroup(scene: Phaser.Scene, bodyType: number): Phaser.Physics.Arcade.Group | null {
  const Group = Phaser.Physics?.Arcade?.Group;
  // Lightweight/non-Arcade hosts retain the individual-collider path.
  if (!Group || !scene.physics?.world) return null;
  class ExistingBodies extends Group {
    private disposed = false;
    private readonly handleShutdown = () => this.destroy(false, false);
    private readonly members = new WeakSet<Phaser.GameObjects.GameObject>();
    constructor() {
      super(scene.physics.world, scene);
      this.physicsType = bodyType;
      // Member masks are still checked by World.separate; the group must not exclude them.
      this.collisionCategory = 0xffffffff;
      this.collisionMask = 0xffffffff;
      scene.events?.once('shutdown', this.handleShutdown);
    }
    override createCallbackHandler(child: Phaser.GameObjects.GameObject): void { this.members.add(child); }
    override removeCallbackHandler(child: Phaser.GameObjects.GameObject): void { this.members.delete(child); }
    override destroy(_destroyChildren = false, _removeFromScene = false): void {
      if (this.disposed) return;
      this.disposed = true;
      scene.events?.off('shutdown', this.handleShutdown);
      super.destroy(false, false);
    }
    override contains(child: Phaser.GameObjects.GameObject): boolean { return !this.disposed && this.members.has(child); }
  }
  return new ExistingBodies();
}
