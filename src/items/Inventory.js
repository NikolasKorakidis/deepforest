// Minimal inventory: stackable consumables + equipment flags. Rifle ammo
// lives in Weapon (mag + reserve) since it's tightly coupled to reloading.

export class Inventory {
  constructor() {
    this.wood = 0;
    this.rations = 0;
    this.hasRifle = false;
    this.hasCompass = false;
    this.hasBinoculars = false;
  }
}
