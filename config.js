const CONFIG = {
  narrationSrc: "assets/audio/narration.mp3",
  musicSrc: "assets/audio/memory.mp3",
  musicFallbackSrc: "assets/audio/memories.mp3",
  creditsMusicSrc: "assets/audio/credits.mp3",
  musicVolume: 0.25,
  creditsMusicVolume: 0.45,
  totalImages: 20,
  imagePathPrefix: "assets/images/",
  imageExtension: ".jpg",
  // 20 images x 8.5 seconds = 170 seconds (02:50)
  imageDurationMs: 8500,
  // Starts at 03:12 (192s): Fast Clock (3.5s) + Searching (2.0s) + Found (2.5s) = finishes at 03:20 (200s)
  countdownStartSec: 192.0,
  countdownDurationSec: 3.5,
  searchingDurationSec: 2.0,
  foundDurationSec: 2.5,
  presentYear: 2026,
  targetPastYear: 2010,
  creditTitlePrefix: "TIME MACHINE OF",
  // Each of the 6 credit cards displays for 3.2 seconds (19.2 seconds total)
  creditCardDurationMs: 3200,
  // Shutdown spinner runs for 10 seconds then powers off completely
  shutdownDurationMs: 10000
};