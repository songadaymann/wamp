/** Derived document data is rebuilt only after a committed edit or a load. */
export class EditorDocumentCache<T> {
  private revision: number | null = null;
  private value: T | null = null;

  get(revision: number, enabled: boolean, build: () => T): T | null {
    if (!enabled) return null;
    if (this.revision !== revision || this.value === null) {
      this.value = build();
      this.revision = revision;
    }
    return this.value;
  }

  reset(): void { this.revision = null; this.value = null; }
}
