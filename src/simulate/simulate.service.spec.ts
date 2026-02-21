import { Test, TestingModule } from '@nestjs/testing';
import { SimulateService } from './simulate.service.js';
import { SimulateEventDto, SimulateEventType } from './dto/simulate-event.dto.js';
import { SEED_STOCKS } from '../common/data/seed-data.js';

describe('SimulateService', () => {
  let service: SimulateService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SimulateService],
    }).compile();

    service = module.get<SimulateService>(SimulateService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  const militaryDto: SimulateEventDto = {
    title: 'Test Military Conflict',
    description: 'A hypothetical military conflict for testing',
    type: SimulateEventType.MILITARY,
    severity: 8,
    location: {
      lat: 10.48,
      lng: -66.9,
      country: 'Venezuela',
    },
  };

  const economicDto: SimulateEventDto = {
    title: 'Test Economic Shock',
    description: 'A hypothetical economic crisis',
    type: SimulateEventType.ECONOMIC,
    severity: 6,
    location: {
      lat: 38.89,
      lng: -77.04,
      country: 'USA',
    },
  };

  describe('runSimulation()', () => {
    it('should return complete SimulationResult structure', () => {
      const result = service.runSimulation(militaryDto);

      expect(result).toHaveProperty('simulatedEventId');
      expect(result).toHaveProperty('title', militaryDto.title);
      expect(result).toHaveProperty('shocks');
      expect(result).toHaveProperty('heatmap');
      expect(result).toHaveProperty('arcs');
      expect(result).toHaveProperty('interlinkednessScore');
      expect(result).toHaveProperty('totalAffectedCompanies');
      expect(result).toHaveProperty('totalAffectedCountries');
      expect(result).toHaveProperty('topAffectedSectors');
    });

    it('should generate unique simulation event IDs', () => {
      const r1 = service.runSimulation(militaryDto);
      const r2 = service.runSimulation(militaryDto);

      expect(r1.simulatedEventId).toMatch(/^sim-/);
      expect(r2.simulatedEventId).toMatch(/^sim-/);
      expect(r1.simulatedEventId).not.toBe(r2.simulatedEventId);
    });

    it('should compute shocks for all seed stocks', () => {
      const result = service.runSimulation(militaryDto);

      expect(result.shocks).toHaveLength(SEED_STOCKS.length);
    });

    it('should sort shocks by absolute score descending', () => {
      const result = service.runSimulation(militaryDto);

      for (let i = 1; i < result.shocks.length; i++) {
        expect(Math.abs(result.shocks[i - 1].score)).toBeGreaterThanOrEqual(
          Math.abs(result.shocks[i].score),
        );
      }
    });

    it('should have shock scores between 0 and 1', () => {
      const result = service.runSimulation(militaryDto);

      result.shocks.forEach((shock) => {
        expect(shock.score).toBeGreaterThanOrEqual(0);
        expect(shock.score).toBeLessThanOrEqual(1);
      });
    });

    it('should assign higher scores to directly affected sectors', () => {
      const result = service.runSimulation(militaryDto);

      // Military events → Defense and Energy should score higher
      const defenseShocks = result.shocks.filter((s) => s.sector === 'Defense');
      const telecomShocks = result.shocks.filter((s) => s.sector === 'Telecommunications');

      if (defenseShocks.length > 0 && telecomShocks.length > 0) {
        const avgDefense = defenseShocks.reduce((sum, s) => sum + s.score, 0) / defenseShocks.length;
        const avgTelecom = telecomShocks.reduce((sum, s) => sum + s.score, 0) / telecomShocks.length;
        expect(avgDefense).toBeGreaterThan(avgTelecom);
      }
    });

    it('should set direction correctly based on sector position', () => {
      const result = service.runSimulation(militaryDto);

      // For military: Defense (idx 0) and Energy (idx 1) → 'up'
      const defenseShocks = result.shocks.filter((s) => s.sector === 'Defense');
      defenseShocks.forEach((s) => {
        expect(s.direction).toBe('up');
      });

      const energyShocks = result.shocks.filter((s) => s.sector === 'Energy');
      energyShocks.forEach((s) => {
        expect(s.direction).toBe('up');
      });
    });

    it('should set actualChange to null for simulated events', () => {
      const result = service.runSimulation(militaryDto);

      result.shocks.forEach((shock) => {
        expect(shock.actualChange).toBeNull();
      });
    });

    it('should set surpriseFactor to null for simulated events', () => {
      const result = service.runSimulation(militaryDto);

      result.shocks.forEach((shock) => {
        expect(shock.surpriseFactor).toBeNull();
      });
    });

    it('should have confidence between 0.5 and 0.95', () => {
      const result = service.runSimulation(militaryDto);

      result.shocks.forEach((shock) => {
        expect(shock.confidence).toBeGreaterThanOrEqual(0.5);
        expect(shock.confidence).toBeLessThanOrEqual(0.95);
      });
    });
  });

  describe('heatmap generation', () => {
    it('should generate heatmap entries grouped by country', () => {
      const result = service.runSimulation(militaryDto);

      const countries = result.heatmap.map((h) => h.country);
      const uniqueCountries = new Set(countries);
      expect(countries.length).toBe(uniqueCountries.size);
    });

    it('should have shockIntensity between 0 and 1', () => {
      const result = service.runSimulation(militaryDto);

      result.heatmap.forEach((entry) => {
        expect(entry.shockIntensity).toBeGreaterThanOrEqual(0);
        expect(entry.shockIntensity).toBeLessThanOrEqual(1);
      });
    });

    it('should include affected sectors for each country', () => {
      const result = service.runSimulation(militaryDto);

      result.heatmap.forEach((entry) => {
        expect(entry.affectedSectors.length).toBeGreaterThan(0);
      });
    });

    it('should include top affected stocks (max 3)', () => {
      const result = service.runSimulation(militaryDto);

      result.heatmap.forEach((entry) => {
        expect(entry.topAffectedStocks.length).toBeGreaterThan(0);
        expect(entry.topAffectedStocks.length).toBeLessThanOrEqual(3);
      });
    });

    it('should assign correct direction (positive/negative/mixed)', () => {
      const result = service.runSimulation(militaryDto);

      result.heatmap.forEach((entry) => {
        expect(['positive', 'negative', 'mixed']).toContain(entry.direction);
      });
    });
  });

  describe('connection arcs', () => {
    it('should start arcs from event epicenter', () => {
      const result = service.runSimulation(militaryDto);

      result.arcs.forEach((arc) => {
        expect(arc.startLat).toBe(militaryDto.location.lat);
        expect(arc.startLng).toBe(militaryDto.location.lng);
      });
    });

    it('should only include arcs for stocks with score > 0.15', () => {
      const result = service.runSimulation(militaryDto);

      result.arcs.forEach((arc) => {
        expect(arc.shockIntensity).toBeGreaterThan(0.15);
      });
    });

    it('should have one arc per country (no duplicates)', () => {
      const result = service.runSimulation(militaryDto);

      const toLabels = result.arcs.map((a) => a.toLabel);
      const unique = new Set(toLabels);
      expect(toLabels.length).toBe(unique.size);
    });

    it('should use green for up, red for down', () => {
      const result = service.runSimulation(militaryDto);

      result.arcs.forEach((arc) => {
        if (arc.direction === 'positive') {
          expect(arc.color).toBe('#22c55e');
        } else {
          expect(arc.color).toBe('#ef4444');
        }
      });
    });

    it('should include event ID in arc ID', () => {
      const result = service.runSimulation(militaryDto);

      result.arcs.forEach((arc) => {
        expect(arc.id).toContain(result.simulatedEventId);
      });
    });
  });

  describe('sector impacts', () => {
    it('should aggregate impacts by sector', () => {
      const result = service.runSimulation(militaryDto);

      const sectors = result.topAffectedSectors.map((s) => s.sector);
      const unique = new Set(sectors);
      expect(sectors.length).toBe(unique.size);
    });

    it('should sort sectors by average shock score descending', () => {
      const result = service.runSimulation(militaryDto);

      for (let i = 1; i < result.topAffectedSectors.length; i++) {
        expect(result.topAffectedSectors[i - 1].averageShockScore).toBeGreaterThanOrEqual(
          result.topAffectedSectors[i].averageShockScore,
        );
      }
    });

    it('should include correct stock counts per sector', () => {
      const result = service.runSimulation(militaryDto);

      result.topAffectedSectors.forEach((impact) => {
        const stocksInSector = SEED_STOCKS.filter((s) => s.sector === impact.sector);
        expect(impact.stockCount).toBe(stocksInSector.length);
      });
    });

    it('should include top 3 stocks per sector', () => {
      const result = service.runSimulation(militaryDto);

      result.topAffectedSectors.forEach((impact) => {
        expect(impact.topStocks.length).toBeLessThanOrEqual(3);
        expect(impact.topStocks.length).toBeGreaterThan(0);
      });
    });
  });

  describe('interlinkedness score', () => {
    it('should be between 0 and 1', () => {
      const result = service.runSimulation(militaryDto);
      expect(result.interlinkednessScore).toBeGreaterThanOrEqual(0);
      expect(result.interlinkednessScore).toBeLessThanOrEqual(1);
    });

    it('should represent ratio of significantly shocked stocks (>0.3)', () => {
      const result = service.runSimulation(militaryDto);

      const sigShocked = result.shocks.filter((s) => Math.abs(s.score) > 0.3);
      const expected = sigShocked.length / result.shocks.length;

      expect(result.interlinkednessScore).toBeCloseTo(expected, 2);
    });
  });

  describe('severity impact', () => {
    it('should produce higher scores with higher severity', () => {
      const lowSeverity: SimulateEventDto = {
        ...militaryDto,
        severity: 2,
      };
      const highSeverity: SimulateEventDto = {
        ...militaryDto,
        severity: 9,
      };

      const lowResult = service.runSimulation(lowSeverity);
      const highResult = service.runSimulation(highSeverity);

      const avgLow = lowResult.shocks.reduce((sum, s) => sum + s.score, 0) / lowResult.shocks.length;
      const avgHigh = highResult.shocks.reduce((sum, s) => sum + s.score, 0) / highResult.shocks.length;

      expect(avgHigh).toBeGreaterThan(avgLow);
    });
  });

  describe('different event types', () => {
    it('should produce valid results for all event types', () => {
      const types = Object.values(SimulateEventType);

      types.forEach((type) => {
        const dto: SimulateEventDto = {
          ...militaryDto,
          type,
        };

        const result = service.runSimulation(dto);

        expect(result.shocks.length).toBe(SEED_STOCKS.length);
        expect(result.heatmap.length).toBeGreaterThan(0);
        expect(result.topAffectedSectors.length).toBeGreaterThan(0);
      });
    });
  });
});
