import { Component } from '@angular/core';
import { ApiService, Item } from '../api.service';

const EMPTY: Partial<Item> = {title: '', description: '', link: ''};

@Component({
  selector: 'app-admin',
  templateUrl: './admin.component.html',
  styleUrls: ['./admin.component.scss'],
})
export class AdminComponent {
  tokenInput = '';
  items: Item[] | null = null;
  error: string | null = null;
  busy = false;

  /** Formular für neuen oder bearbeiteten Eintrag. */
  form: Partial<Item> = {...EMPTY};
  file: File | null = null;
  preview: string | null = null;

  readonly days = Array.from({length: 24}, (_, i) => i + 1);
  readonly openOptions = Array.from({length: 25}, (_, i) => i);

  constructor(public api: ApiService) {
    if (api.adminToken) {
      this.load();
    }
  }

  get freeCount() {
    return this.items?.filter((i) => !i.assignedDay).length || 0;
  }

  async login() {
    this.api.adminToken = this.tokenInput.trim();
    await this.load();
    if (this.items) {
      this.api.refresh();
    }
  }

  logout() {
    this.api.adminToken = '';
    this.items = null;
    this.api.refresh();
  }

  async load() {
    await this.run(async () => this.items = await this.api.items());
    if (!this.items) {
      this.api.adminToken = '';
    }
  }

  /** Auswahl im Select: 'auto' oder Türchennummer als String. */
  get openSelection() {
    const override = this.api.calendar$.value?.openOverride;
    return override === null || override === undefined ? 'auto' : String(override);
  }

  async setOpenUntil(value: string) {
    await this.run(() => this.api.setOpenUntil(value === 'auto' ? null : Number(value)));
  }

  edit(item: Item) {
    this.form = {...item};
    this.file = null;
    this.preview = item.image;
    window.scrollTo({top: 0, behavior: 'smooth'});
  }

  reset() {
    this.form = {...EMPTY};
    this.file = null;
    this.preview = null;
  }

  onFile(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0] || null;
    this.file = file;
    if (this.preview?.startsWith('blob:')) {
      URL.revokeObjectURL(this.preview);
    }
    this.preview = file ? URL.createObjectURL(file) : (this.form.image || null);
  }

  async save() {
    await this.run(async () => {
      const id = await this.api.saveItem({id: this.form.id, title: this.form.title, description: this.form.description, link: this.form.link});
      if (this.file) {
        await this.api.upload(id, this.file);
      }
      this.reset();
      this.items = await this.api.items();
      this.api.refresh();
    });
  }

  async remove(item: Item) {
    if (!confirm(`„${item.title}“ löschen?`)) {
      return;
    }
    await this.run(async () => {
      await this.api.deleteItem(item.id);
      this.items = await this.api.items();
    });
  }

  itemForDay(day: number) {
    return this.items?.find((i) => i.assignedDay === day)?.id || '';
  }

  /** Auswahl für ein Türchen: freie Einträge plus der aktuell zugeordnete. */
  optionsForDay(day: number) {
    return this.items?.filter((i) => !i.assignedDay || i.assignedDay === day) || [];
  }

  async assign(day: number, itemId: string) {
    await this.run(async () => {
      await this.api.assign(day, itemId || null);
      this.items = await this.api.items();
    });
  }

  trackById(_: number, i: Item) {
    return i.id;
  }

  private async run(fn: () => Promise<unknown>) {
    this.error = null;
    this.busy = true;
    try {
      await fn();
    } catch (e) {
      this.error = (e as Error).message;
    } finally {
      this.busy = false;
    }
  }
}
