import { describe, expect, it, vi } from 'vitest';
import { deleteCustomSpriteIfUnused } from './deletion';

describe('deleteCustomSpriteIfUnused', () => {
  it('blocks deletion when an unsaved or local room uses the sprite', async () => {
    const loadRemoteUsage = vi.fn(async () => ({ inUse: false }));
    const removeLocalSprite = vi.fn(() => true);

    await expect(deleteCustomSpriteIfUnused('used', {
      isUsedLocally: () => true,
      loadRemoteUsage,
      removeLocalSprite,
    })).resolves.toBe('in-use');
    expect(loadRemoteUsage).not.toHaveBeenCalled();
    expect(removeLocalSprite).not.toHaveBeenCalled();
  });

  it('blocks deletion when a stored server room uses the sprite', async () => {
    const removeLocalSprite = vi.fn(() => true);

    await expect(deleteCustomSpriteIfUnused('used', {
      isUsedLocally: () => false,
      loadRemoteUsage: async () => ({ inUse: true }),
      removeLocalSprite,
    })).resolves.toBe('in-use');
    expect(removeLocalSprite).not.toHaveBeenCalled();
  });

  it('fails closed when usage cannot be verified', async () => {
    const removeLocalSprite = vi.fn(() => true);

    await expect(deleteCustomSpriteIfUnused('unknown', {
      isUsedLocally: () => false,
      loadRemoteUsage: async () => {
        throw new Error('offline');
      },
      removeLocalSprite,
    })).resolves.toBe('verification-failed');
    expect(removeLocalSprite).not.toHaveBeenCalled();
  });

  it('removes an unused local sprite after both checks pass', async () => {
    const removeLocalSprite = vi.fn(() => true);

    await expect(deleteCustomSpriteIfUnused('unused', {
      isUsedLocally: () => false,
      loadRemoteUsage: async () => ({ inUse: false }),
      removeLocalSprite,
    })).resolves.toBe('deleted');
    expect(removeLocalSprite).toHaveBeenCalledWith('unused');
  });
});
