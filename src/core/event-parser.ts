/**
 * event-parser.ts
 * Handles parsing and processing of game events
 * Adds human-readable information and manages city tracking
 */

import {
  GameEvent,
  EventType,
  City,
  Tile
} from '../types';

/**
 * EventParser class
 * Processes raw game events and enriches them with contextual information
 */
export class EventParser {
  private cities: Record<string, City> = {};

  /**
   * Process game events and add human-readable information
   * @param events Raw events from replay data
   * @param civs List of civilizations for name lookup
   * @returns Processed events with enriched data
   */
  public processEvents(events: GameEvent[], civs: { name: string }[]): GameEvent[] {
    this.cities = {};
    const processedEvents: GameEvent[] = [];

    events.forEach((event: GameEvent, index: number) => {
      const eventsToAdd: GameEvent[] = [event];

      event.index = index;
      event.civ = this.getCivName(event.civId, civs);

      // Convert typeId to EventType enum
      event.type = (event.typeId ?? 0) as EventType;

      // Add x/y reference for single-tile events
      if (event.tiles && event.tiles.length === 1 &&
          event.type !== EventType.TilesClaimed) {
        event.x = event.tiles[0].x;
        event.y = event.tiles[0].y;
      }

      // Process specific event types
      if (event.type === EventType.CityFounded) {
        this.processCityFoundedEvent(event);
      } else if (event.type === EventType.CityRazed) {
        eventsToAdd.push(...this.processCityRazedEvents(event));
      } else if (event.type === EventType.CitiesTransferred) {
        this.processCitiesTransferredEvent(event);
      } else if (event.type === EventType.TilesClaimed) {
        this.processTilesClaimedEvent(event);
      }

      processedEvents.push(...eventsToAdd);
    });

    return processedEvents;
  }

  /**
   * Get civilization name from ID
   */
  private getCivName(civId: number | undefined, civs: { name: string }[]): string | null {
    if (civId === undefined || civId < 0 || civId >= civs.length) {
      return null;
    }
    return civs[civId].name;
  }

  /**
   * Process city founded event
   */
  private processCityFoundedEvent(event: GameEvent): void {
    const cityName = (event.text || '').replace(' is founded.', '');
    event.city = { name: cityName, owner: event.civ };
    if (event.x !== undefined && event.y !== undefined) {
      this.cities[`${event.x},${event.y}`] = event.city;
    }
  }

  /**
   * Process city razed events (can be multiple if mass razing)
   */
  private processCityRazedEvents(event: GameEvent): GameEvent[] {
    const additionalEvents: GameEvent[] = [];

    if (event.tiles && event.tiles.length > 0) {
      event.x = event.tiles[0].x;
      event.y = event.tiles[0].y;
      event.city = this.cities[`${event.x},${event.y}`];
      if (event.city) {
        event.text = `${event.city.name} has been burned to the ground by ${event.civ}!`;
      }

      // Handle mass razings
      event.tiles.slice(1).forEach((tile: Tile) => {
        const eventCopy = { ...event };
        eventCopy.x = tile.x;
        eventCopy.y = tile.y;
        eventCopy.city = this.cities[`${tile.x},${tile.y}`];
        if (eventCopy.city) {
          eventCopy.text = `${eventCopy.city.name} has been burned to the ground by ${eventCopy.civ}!`;
        }
        additionalEvents.push(eventCopy);
      });
    }

    return additionalEvents;
  }

  /**
   * Process cities transferred event
   */
  private processCitiesTransferredEvent(event: GameEvent): void {
    if (!event.tiles) return;

    const cityNames = event.tiles.map((tile: Tile) => {
      const city = this.cities[`${tile.x},${tile.y}`];
      return city ? city.name : 'Unknown';
    });

    if (cityNames.length === 1) {
      event.text = `${event.civ} now controls the city of ${cityNames[0]}.`;
    } else if (cityNames.length > 1) {
      const lastCity = cityNames.pop();
      const citiesString = cityNames.length === 1 ? cityNames[0] : cityNames.join(', ') + ',';
      event.text = `${event.civ} now controls the cities of ${citiesString} and ${lastCity}.`;
    }
  }

  /**
   * Process tiles claimed event
   */
  private processTilesClaimedEvent(event: GameEvent): void {
    if (!event.tiles) return;

    const tileCount = event.tiles.length;
    if (event.civ) {
      event.text = `${event.civ} has claimed ${tileCount} tile${tileCount > 1 ? 's' : ''}.`;
    } else {
      event.text = `${tileCount} tile${tileCount > 1 ? 's have' : ' has'} been abandoned!`;
    }
  }

  /**
   * Get the cities registry
   * @returns Record of city coordinates to city data
   */
  public getCities(): Record<string, City> {
    return this.cities;
  }
}