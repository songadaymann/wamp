import Phaser from 'phaser';

export type LiveObjectPhysicsGroupCategory =
  | 'collectibles'
  | 'hazards'
  | 'enemies'
  | 'npcs'
  | 'solidPlatforms'
  | 'ladderSupports'
  | 'bouncePads'
  | 'projectiles'
  | 'dynamicActors'
  | 'solidObstacles';

export interface LiveObjectPhysicsMetadata<TRoom, TLiveObject> {
  room: TRoom;
  liveObject: TLiveObject;
}

export interface LiveObjectPhysicsRegistryDebugSnapshot {
  memberships: Record<LiveObjectPhysicsGroupCategory, number>;
  playerColliderCount: number;
  sharedObjectColliderCount: number;
  terrainRoomCount: number;
}

interface LiveObjectPhysicsRegistryCallbacks<TRoom, TLiveObject> {
  onPlayerCollectible(metadata: LiveObjectPhysicsMetadata<TRoom, TLiveObject>): void;
  onPlayerHazard(metadata: LiveObjectPhysicsMetadata<TRoom, TLiveObject>): void;
  onPlayerEnemy(metadata: LiveObjectPhysicsMetadata<TRoom, TLiveObject>): void;
  onPlayerNpc(metadata: LiveObjectPhysicsMetadata<TRoom, TLiveObject>): void;
  onPlayerSolid(metadata: LiveObjectPhysicsMetadata<TRoom, TLiveObject>): void;
  onPlayerBouncePad(metadata: LiveObjectPhysicsMetadata<TRoom, TLiveObject>): void;
  onPlayerProjectile(metadata: LiveObjectPhysicsMetadata<TRoom, TLiveObject>): void;
  onNpcEnvironment(
    npc: LiveObjectPhysicsMetadata<TRoom, TLiveObject>,
    environment: LiveObjectPhysicsMetadata<TRoom, TLiveObject>,
  ): void;
  onDynamicSolid(
    actor: LiveObjectPhysicsMetadata<TRoom, TLiveObject>,
    obstacle: LiveObjectPhysicsMetadata<TRoom, TLiveObject>,
  ): void;
  onProjectileSolid(
    projectile: LiveObjectPhysicsMetadata<TRoom, TLiveObject>,
    obstacle: LiveObjectPhysicsMetadata<TRoom, TLiveObject>,
  ): void;
  onProjectileNpc(
    projectile: LiveObjectPhysicsMetadata<TRoom, TLiveObject>,
    npc: LiveObjectPhysicsMetadata<TRoom, TLiveObject>,
  ): void;
  onProjectileTerrain(metadata: LiveObjectPhysicsMetadata<TRoom, TLiveObject>): void;
  shouldPlayerNpc(metadata: LiveObjectPhysicsMetadata<TRoom, TLiveObject>): boolean;
  shouldPlayerSolid(metadata: LiveObjectPhysicsMetadata<TRoom, TLiveObject>): boolean;
  shouldPlayerLadder(
    metadata: LiveObjectPhysicsMetadata<TRoom, TLiveObject>,
    support: Phaser.GameObjects.GameObject,
  ): boolean;
  shouldDynamicSolid(
    actor: LiveObjectPhysicsMetadata<TRoom, TLiveObject>,
    obstacle: LiveObjectPhysicsMetadata<TRoom, TLiveObject>,
  ): boolean;
}

interface TerrainRegistration {
  terrainLayer: Phaser.Tilemaps.TilemapLayer;
  terrainInsetBodies: Phaser.Physics.Arcade.StaticGroup | null;
}

export class LiveObjectPhysicsRegistry<TRoom, TLiveObject extends object> {
  private groups: Record<
    LiveObjectPhysicsGroupCategory,
    Phaser.Physics.Arcade.Group
  > | null = null;
  private readonly metadataByGameObject = new WeakMap<
    Phaser.GameObjects.GameObject,
    LiveObjectPhysicsMetadata<TRoom, TLiveObject>
  >();
  private readonly categoriesByLiveObject = new WeakMap<
    TLiveObject,
    readonly LiveObjectPhysicsGroupCategory[]
  >();
  private readonly playerColliders: Phaser.Physics.Arcade.Collider[] = [];
  private readonly sharedObjectColliders: Phaser.Physics.Arcade.Collider[] = [];
  private readonly terrainCollidersByRoom = new Map<TRoom, Phaser.Physics.Arcade.Collider[]>();
  private player: Phaser.GameObjects.GameObject | null = null;
  private pickupSensor: Phaser.GameObjects.GameObject | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly callbacks: LiveObjectPhysicsRegistryCallbacks<TRoom, TLiveObject>,
  ) {}

  register(
    metadata: LiveObjectPhysicsMetadata<TRoom, TLiveObject>,
    sprite: Phaser.GameObjects.Sprite,
    categories: readonly LiveObjectPhysicsGroupCategory[],
  ): void {
    this.unregister(metadata.liveObject, sprite);
    this.metadataByGameObject.set(sprite, metadata);
    this.categoriesByLiveObject.set(metadata.liveObject, categories);
    this.addToCategories(sprite, categories);
  }

  registerHelper(
    metadata: LiveObjectPhysicsMetadata<TRoom, TLiveObject>,
    helper: Phaser.GameObjects.GameObject,
    category: 'ladderSupports',
  ): void {
    this.metadataByGameObject.set(helper, metadata);
    this.ensureGroups()[category].add(helper);
  }

  unregister(
    liveObject: TLiveObject,
    sprite: Phaser.GameObjects.Sprite,
    helpers: readonly Phaser.GameObjects.GameObject[] = [],
  ): void {
    const categories = this.categoriesByLiveObject.get(liveObject);
    if (categories && this.groups) {
      for (const category of categories) {
        this.groups[category].remove(sprite, false, false);
      }
    }
    this.categoriesByLiveObject.delete(liveObject);
    this.metadataByGameObject.delete(sprite);
    if (this.groups) {
      for (const helper of helpers) {
        this.groups.ladderSupports.remove(helper, false, false);
        this.metadataByGameObject.delete(helper);
      }
    }
  }

  setSleeping(
    liveObject: TLiveObject,
    sprite: Phaser.GameObjects.Sprite,
    sleeping: boolean,
  ): void {
    const categories = this.categoriesByLiveObject.get(liveObject);
    if (!categories) {
      return;
    }
    if (sleeping) {
      if (!this.groups) return;
      for (const category of categories) {
        this.groups[category].remove(sprite, false, false);
      }
      return;
    }
    this.addToCategories(sprite, categories);
  }

  registerTerrain(room: TRoom, registration: TerrainRegistration): void {
    this.unregisterTerrain(room);
    const groups = this.ensureGroups();
    const colliders: Phaser.Physics.Arcade.Collider[] = [
      this.scene.physics.add.collider(groups.dynamicActors, registration.terrainLayer),
      this.scene.physics.add.collider(
        groups.projectiles,
        registration.terrainLayer,
        (object1, object2) => {
          const metadata = this.resolveMetadata(object1) ?? this.resolveMetadata(object2);
          if (metadata) this.callbacks.onProjectileTerrain(metadata);
        },
      ),
    ];
    if (registration.terrainInsetBodies) {
      colliders.push(
        this.scene.physics.add.collider(groups.dynamicActors, registration.terrainInsetBodies),
        this.scene.physics.add.collider(
          groups.projectiles,
          registration.terrainInsetBodies,
          (object1, object2) => {
            const metadata = this.resolveMetadata(object1) ?? this.resolveMetadata(object2);
            if (metadata) this.callbacks.onProjectileTerrain(metadata);
          },
        ),
      );
    }
    this.terrainCollidersByRoom.set(room, colliders);
  }

  unregisterTerrain(room: TRoom): void {
    const colliders = this.terrainCollidersByRoom.get(room);
    if (!colliders) return;
    for (const collider of colliders) collider.destroy();
    this.terrainCollidersByRoom.delete(room);
  }

  syncPlayer(
    player: Phaser.GameObjects.GameObject | null,
    pickupSensor: Phaser.GameObjects.GameObject | null,
  ): void {
    if (this.player === player && this.pickupSensor === pickupSensor) {
      return;
    }
    this.destroyPlayerColliders();
    this.player = player;
    this.pickupSensor = pickupSensor;
    if (!player) {
      return;
    }

    const groups = this.ensureGroups();
    if (pickupSensor) {
      this.playerColliders.push(
        this.scene.physics.add.overlap(pickupSensor, groups.collectibles, (object1, object2) => {
          this.withSingleMetadata(object1, object2, this.callbacks.onPlayerCollectible);
        }),
      );
    }
    this.playerColliders.push(
      this.scene.physics.add.overlap(player, groups.hazards, (object1, object2) => {
        this.withSingleMetadata(object1, object2, this.callbacks.onPlayerHazard);
      }),
      this.scene.physics.add.overlap(player, groups.enemies, (object1, object2) => {
        this.withSingleMetadata(object1, object2, this.callbacks.onPlayerEnemy);
      }),
      this.scene.physics.add.overlap(player, groups.bouncePads, (object1, object2) => {
        this.withSingleMetadata(object1, object2, this.callbacks.onPlayerBouncePad);
      }),
      this.scene.physics.add.overlap(player, groups.projectiles, (object1, object2) => {
        this.withSingleMetadata(object1, object2, this.callbacks.onPlayerProjectile);
      }),
      this.scene.physics.add.collider(
        player,
        groups.npcs,
        (object1, object2) => {
          this.withSingleMetadata(object1, object2, this.callbacks.onPlayerNpc);
        },
        (object1, object2) => this.withSingleMetadataResult(
          object1,
          object2,
          this.callbacks.shouldPlayerNpc,
        ),
      ),
      this.scene.physics.add.collider(
        player,
        groups.solidPlatforms,
        (object1, object2) => {
          this.withSingleMetadata(object1, object2, this.callbacks.onPlayerSolid);
        },
        (object1, object2) => this.withSingleMetadataResult(
          object1,
          object2,
          this.callbacks.shouldPlayerSolid,
        ),
      ),
      this.scene.physics.add.collider(
        player,
        groups.ladderSupports,
        undefined,
        (object1, object2) => {
          const support = this.resolveGameObject(object1) ?? this.resolveGameObject(object2);
          const metadata = support ? this.metadataByGameObject.get(support) : null;
          return Boolean(
            support
            && metadata
            && this.callbacks.shouldPlayerLadder(metadata, support)
          );
        },
      ),
    );
  }

  getDebugSnapshot(): LiveObjectPhysicsRegistryDebugSnapshot {
    const getMembershipCount = (category: LiveObjectPhysicsGroupCategory): number => (
      this.groups?.[category].getLength() ?? 0
    );
    return {
      memberships: {
        collectibles: getMembershipCount('collectibles'),
        hazards: getMembershipCount('hazards'),
        enemies: getMembershipCount('enemies'),
        npcs: getMembershipCount('npcs'),
        solidPlatforms: getMembershipCount('solidPlatforms'),
        ladderSupports: getMembershipCount('ladderSupports'),
        bouncePads: getMembershipCount('bouncePads'),
        projectiles: getMembershipCount('projectiles'),
        dynamicActors: getMembershipCount('dynamicActors'),
        solidObstacles: getMembershipCount('solidObstacles'),
      },
      playerColliderCount: this.playerColliders.length,
      sharedObjectColliderCount: this.sharedObjectColliders.length,
      terrainRoomCount: this.terrainCollidersByRoom.size,
    };
  }

  destroy(): void {
    this.destroyPlayerColliders();
    for (const collider of this.sharedObjectColliders) collider.destroy();
    this.sharedObjectColliders.length = 0;
    for (const colliders of this.terrainCollidersByRoom.values()) {
      for (const collider of colliders) collider.destroy();
    }
    this.terrainCollidersByRoom.clear();
    if (this.groups) {
      for (const group of Object.values(this.groups)) {
        group.clear(false, false);
        group.destroy();
      }
      this.groups = null;
    }
    this.player = null;
    this.pickupSensor = null;
  }

  private ensureGroups(): Record<
    LiveObjectPhysicsGroupCategory,
    Phaser.Physics.Arcade.Group
  > {
    if (this.groups) {
      return this.groups;
    }
    const createGroup = () => {
      const group = this.scene.physics.add.group({ runChildUpdate: false });
      // Membership is an index over bodies configured by the object factory.
      // Phaser Physics Groups otherwise overwrite body gravity, velocity, and
      // static-body-incompatible defaults whenever an existing object is added.
      const defaults = group.defaults as unknown as Record<string, unknown>;
      for (const key of Object.keys(defaults)) {
        delete defaults[key];
      }
      return group;
    };
    this.groups = {
      collectibles: createGroup(),
      hazards: createGroup(),
      enemies: createGroup(),
      npcs: createGroup(),
      solidPlatforms: createGroup(),
      ladderSupports: createGroup(),
      bouncePads: createGroup(),
      projectiles: createGroup(),
      dynamicActors: createGroup(),
      solidObstacles: createGroup(),
    };
    this.installSharedObjectColliders(this.groups);
    return this.groups;
  }

  private installSharedObjectColliders(
    groups: Record<LiveObjectPhysicsGroupCategory, Phaser.Physics.Arcade.Group>,
  ): void {
    this.sharedObjectColliders.push(
      this.scene.physics.add.overlap(groups.npcs, groups.hazards, (object1, object2) => {
        this.withPairMetadata(object1, object2, this.callbacks.onNpcEnvironment);
      }),
      this.scene.physics.add.overlap(groups.npcs, groups.enemies, (object1, object2) => {
        this.withPairMetadata(object1, object2, this.callbacks.onNpcEnvironment);
      }),
      this.scene.physics.add.collider(
        groups.dynamicActors,
        groups.solidObstacles,
        (object1, object2) => {
          this.withPairMetadata(object1, object2, this.callbacks.onDynamicSolid);
        },
        (object1, object2) => this.withPairMetadataResult(
          object1,
          object2,
          this.callbacks.shouldDynamicSolid,
        ),
      ),
      this.scene.physics.add.collider(
        groups.projectiles,
        groups.solidObstacles,
        (object1, object2) => {
          this.withPairMetadata(object1, object2, this.callbacks.onProjectileSolid);
        },
      ),
      this.scene.physics.add.overlap(groups.projectiles, groups.npcs, (object1, object2) => {
        this.withPairMetadata(object1, object2, this.callbacks.onProjectileNpc);
      }),
    );
  }

  private addToCategories(
    sprite: Phaser.GameObjects.Sprite,
    categories: readonly LiveObjectPhysicsGroupCategory[],
  ): void {
    const groups = this.ensureGroups();
    for (const category of categories) {
      groups[category].add(sprite);
    }
  }

  private destroyPlayerColliders(): void {
    for (const collider of this.playerColliders) collider.destroy();
    this.playerColliders.length = 0;
  }

  private resolveGameObject(value: unknown): Phaser.GameObjects.GameObject | null {
    return value instanceof Phaser.GameObjects.GameObject ? value : null;
  }

  private resolveMetadata(value: unknown): LiveObjectPhysicsMetadata<TRoom, TLiveObject> | null {
    const gameObject = this.resolveGameObject(value);
    return gameObject ? this.metadataByGameObject.get(gameObject) ?? null : null;
  }

  private withSingleMetadata(
    object1: unknown,
    object2: unknown,
    callback: (metadata: LiveObjectPhysicsMetadata<TRoom, TLiveObject>) => void,
  ): void {
    const metadata = this.resolveMetadata(object1) ?? this.resolveMetadata(object2);
    if (metadata) callback(metadata);
  }

  private withSingleMetadataResult(
    object1: unknown,
    object2: unknown,
    callback: (metadata: LiveObjectPhysicsMetadata<TRoom, TLiveObject>) => boolean,
  ): boolean {
    const metadata = this.resolveMetadata(object1) ?? this.resolveMetadata(object2);
    return metadata ? callback(metadata) : false;
  }

  private withPairMetadata(
    object1: unknown,
    object2: unknown,
    callback: (
      first: LiveObjectPhysicsMetadata<TRoom, TLiveObject>,
      second: LiveObjectPhysicsMetadata<TRoom, TLiveObject>,
    ) => void,
  ): void {
    const first = this.resolveMetadata(object1);
    const second = this.resolveMetadata(object2);
    if (first && second && first.liveObject !== second.liveObject) callback(first, second);
  }

  private withPairMetadataResult(
    object1: unknown,
    object2: unknown,
    callback: (
      first: LiveObjectPhysicsMetadata<TRoom, TLiveObject>,
      second: LiveObjectPhysicsMetadata<TRoom, TLiveObject>,
    ) => boolean,
  ): boolean {
    const first = this.resolveMetadata(object1);
    const second = this.resolveMetadata(object2);
    return Boolean(
      first
      && second
      && first.liveObject !== second.liveObject
      && callback(first, second)
    );
  }
}
