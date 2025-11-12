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
import { Replay } from './replay';

/**
 * EventParser class
 * Processes raw game events and enriches them with contextual information
 */
export class EventParser {
  private cities: Record<string, City> = {};
  private replay: Replay;

  constructor(replay: Replay) {
    this.replay = replay;
  }

  /**
   * Process game events and add human-readable information
   * @param events Raw events from replay data
   * @returns Processed events with enriched data
   */
  public processEvents(events: GameEvent[]): GameEvent[] {
    this.cities = {};
    const processedEvents: GameEvent[] = [];

    events.forEach((event: GameEvent, index: number) => {
      const eventsToAdd: GameEvent[] = [event];

      event.index = index;

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
      } else if (event.type === EventType.Message) {
        this.processMessageEvent(event);
      }

      processedEvents.push(...eventsToAdd);
    });

    return processedEvents;
  }


  /**
   * Process city founded event
   */
  private processCityFoundedEvent(event: GameEvent): void {
    const cityName = (event.text || '').replace(' is founded.', '');
    const civName = this.replay.getCivName(event.civId);
    event.city = { name: cityName, owner: civName };
    if (event.x !== undefined && event.y !== undefined) {
      this.cities[`${event.x},${event.y}`] = event.city;
    }
    event.text = `Founded the city of ${cityName}.`;
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
        event.text = `Burned ${event.city.name} to the ground!`;
      }

      // Handle mass razings
      event.tiles.slice(1).forEach((tile: Tile) => {
        const eventCopy = { ...event };
        eventCopy.x = tile.x;
        eventCopy.y = tile.y;
        eventCopy.city = this.cities[`${tile.x},${tile.y}`];
        if (eventCopy.city) {
          eventCopy.text = `Burned ${eventCopy.city.name} to the ground!`;
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
      event.text = `Controls the city of ${cityNames[0]}.`;
    } else if (cityNames.length > 1) {
      const lastCity = cityNames.pop();
      const citiesString = cityNames.length === 1 ? cityNames[0] : cityNames.join(', ') + ',';
      event.text = `Controls the cities of ${citiesString} and ${lastCity}.`;
    }
  }

  /**
   * Process tiles claimed event
   */
  private processTilesClaimedEvent(event: GameEvent): void {
    if (!event.tiles) return;

    const tileCount = event.tiles.length;
    event.text = `Claimed ${tileCount} tile${tileCount > 1 ? 's' : ''}.`;
  }

  /**
   * Process message event
   */
  private processMessageEvent(event: GameEvent): void {
    if (!event.text) return;

    // Find the mistakenly encoded UTF8 arrow and replace it
    if (event.text.includes("â")) {
      event.text = event.text.replace(/â\u0086\u0092/g, "→");
      event.type = EventType.Reasoning;
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