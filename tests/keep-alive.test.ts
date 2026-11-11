import { describe, expect, it, vi, beforeEach } from 'vitest';
import { BackgroundKeepAlive } from '../src/keep-alive';

describe('BackgroundKeepAlive', () => {
  let keeper: BackgroundKeepAlive;

  beforeEach(() => {
    keeper = new BackgroundKeepAlive();
  });

  it('initializes in inactive state', () => {
    expect(keeper.isRunning()).toBe(false);
  });

  it('starts and marks as running', () => {
    keeper.start();
    expect(keeper.isRunning()).toBe(true);
  });

  it('stops and marks as inactive', () => {
    keeper.start();
    expect(keeper.isRunning()).toBe(true);
    keeper.stop();
    expect(keeper.isRunning()).toBe(false);
  });

  it('handles multiple starts and stops idempotently', () => {
    keeper.start();
    keeper.start();
    expect(keeper.isRunning()).toBe(true);
    keeper.stop();
    keeper.stop();
    expect(keeper.isRunning()).toBe(false);
  });

  it('safely handles environments with mock AudioContext', () => {
    const mockResume = vi.fn().mockResolvedValue(undefined);
    const mockClose = vi.fn().mockResolvedValue(undefined);
    const mockConnect = vi.fn();
    const mockDisconnect = vi.fn();
    const mockSetValueAtTime = vi.fn();
    const mockStart = vi.fn();
    const mockStop = vi.fn();

    class MockAudioContext {
      state = 'suspended';
      currentTime = 0;
      destination = {};
      resume = mockResume;
      close = mockClose;
      createGain = () => ({
        gain: { setValueAtTime: mockSetValueAtTime },
        connect: mockConnect,
        disconnect: mockDisconnect,
      });
      createOscillator = () => ({
        frequency: { setValueAtTime: mockSetValueAtTime },
        connect: mockConnect,
        disconnect: mockDisconnect,
        start: mockStart,
        stop: mockStop,
      });
    }

    vi.stubGlobal('AudioContext', MockAudioContext);
    vi.stubGlobal('window', { AudioContext: MockAudioContext });

    const testKeeper = new BackgroundKeepAlive();
    testKeeper.start();
    expect(mockResume).toHaveBeenCalled();
    expect(mockStart).toHaveBeenCalled();
    expect(testKeeper.isRunning()).toBe(true);

    testKeeper.stop();
    expect(mockStop).toHaveBeenCalled();
    expect(mockClose).toHaveBeenCalled();
    expect(testKeeper.isRunning()).toBe(false);

    vi.unstubAllGlobals();
  });
});
