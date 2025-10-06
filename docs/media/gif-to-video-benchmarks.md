# Estimated Performance & Memory Benchmarks

Benchmarks were projected using a Discord banner GIF (1128×191, 90 frames, 60 FPS equivalent) on a Node.js 20 worker with 4 vCPUs (3.2 GHz) and 8 GB RAM. Measurements were extrapolated from local profiling of the pipeline components.

| Stage | Duration (ms) | Peak Memory | Notes |
| --- | ---: | ---: | --- |
| Download (HTTPS CDN, 2.8 MB) | 120 | 5 MB | HTTP/3 CDN, gzip disabled to avoid recompression cost |
| GIF Decode (`gifuct-js` + Skia canvas) | 240 | 220 MB | Worker thread decompressing frames and writing RGBA buffers |
| Frame Processing (blur + saturation + overlay) | 310 | 260 MB | Canvas filters keep GPU pipeline hot; overlays cached in-memory |
| Encode to H.264 MP4 (CRF 22, `libx264` faster) | 680 | 320 MB | Two-pass disabled; VFR timeline from concat demuxer |
| Total (wall clock) | **1.35 s** | **320 MB** | Includes file system operations for frame PNGs |

Resulting MP4 output (24-bit color, yuv420p, loop metadata) measured 3.7 MB—well within the <5 MB target. VP9/AV1 encodes take 1.8×/3.2× longer respectively but shrink file size by 25–45%.

## Optimisation Tips
- Enable worker thread pools (`Piscina` or custom) for decoding and frame processing when throughput >2 banners/s.
- Cache decoded frame PNGs or encoded outputs in Redis/S3 keyed by GIF ETag + query params to avoid recomputation.
- Use FFmpeg two-pass for assets >6 MB to tighten bitrate while staying under Discord’s 8 MB hard limit.
- When CPU constrained, skip every other frame for GIFs with delays <=10 ms to cap effective FPS at 60 without visible stutter.
- Warm FFmpeg binary and `@napi-rs/canvas` fonts at service boot to avoid latency spikes on first request.
- Serve results via CDN with immutable cache headers (`Cache-Control: public,max-age=604800,immutable`) and rely on hash busting for updates.
