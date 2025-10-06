# GIF to Modern Video Conversion Architecture

## Overview
This document proposes a high-performance pipeline for converting high-frame-rate Discord banners (60–120 FPS, high detail) from GIF into modern video containers (MP4/WebM/AVIF) that render smoothly across Discord, browsers and mobile clients while supporting overlays and transparency-aware processing.

## Why Discord Uses Video for Animated Assets
- **Frame timing accuracy**: GIF stores per-frame delays in centiseconds with limited precision, causing timing drift. Discord converts uploads to MP4/WebM to leverage millisecond-accurate timestamps and hardware decoding.
- **Hardware acceleration**: Native video codecs benefit from GPU decoding on desktop and mobile, lowering CPU use compared to software GIF decoders.
- **Smaller payloads**: VP9/H.264/AV1 compression reduces animated asset size by ~70–90% compared to equivalent GIFs. Discord delivers MP4/WebM with static PNG fallbacks for older clients.
- **Alpha channel handling**: GIF only supports 1-bit transparency; Discord’s pipeline composites source frames over RGB backgrounds before encoding video and exposes a static PNG when alpha fidelity is required.

## Goals
- Lossless frame accuracy, smooth playback and low latency decoding.
- Optimal file sizes (<5 MB) with tuning knobs per target platform.
- Extensible, fault-tolerant architecture compliant with SOLID principles.
- Capability to overlay dynamic content (text, avatars, badges) at render time.
- Production-ready operational guidance (caching, observability, failure fallbacks).

## Architectural Layers
1. **Acquisition Layer** (`GifRemoteFetcher`)
   - Streams remote GIFs via HTTP(S) with validation, retries, checksum & caching hints.
   - Enforces limits (max resolution, frame count, bytes) to guard resource exhaustion.
   - Emits an async iterable of Buffer chunks for streaming decode.
2. **Decoding Layer** (`GifFrameDecoder`)
   - Uses `gifuct-js` to parse GIF headers and decompress frames.
   - Outputs normalized `DecodedFrame` objects with full RGBA bitmaps, delay metadata and disposal ops.
   - Runs in worker threads to parallelize CPU-heavy LZW decompression.
3. **Processing Layer** (`FrameProcessorPipeline`)
   - Stateless functional operations compose transformations (blur, saturation, overlays, blend modes).
   - GPU-friendly rendering through `@napi-rs/canvas` (Skia backend) with optional `sharp` acceleration for convolution ops.
   - Supports dynamic overlays (avatars fetched via CDN, text using Canvas2D APIs) and color grading.
4. **Encoding Layer** (`VideoEncoder`)
   - Streams processed frames into FFmpeg via `fluent-ffmpeg` or `@ffmpeg/core`.
   - Selects codec/container per target (H.264 MP4 for Discord, VP9/AV1 WebM for browsers, AVIF sequence for fallbacks).
   - Applies two-pass rate control, constant frame rate enforcement, color space tagging (BT.709) and loop metadata where supported.
5. **Delivery Layer** (`DiscordVideoAssetService`)
   - Stores finished assets in cache/CDN (Redis + S3/Cloudflare R2) with content hashing for dedupe.
   - Supplies `AttachmentBuilder` instances for Discord messages/interactions.
   - Generates static PNG fallback (first frame) on failure or when file size exceeds Discord limits.

## Data Flow
```text
Remote GIF URL → GifRemoteFetcher → GifFrameDecoder → FrameProcessorPipeline → VideoEncoder → AssetCache/CDN → Discord Attachment
```

## Modularity & SOLID Compliance
- **Single Responsibility**: Each class handles one stage (fetch, decode, process, encode, deliver).
- **Open/Closed**: Processing operations implement a shared interface; new effects can be added without changing the pipeline core.
- **Liskov Substitution**: Abstractions (`FrameProcessor`, `Encoder`) expose contracts enabling mocks for tests.
- **Interface Segregation**: Lightweight interfaces (e.g., `FrameConsumer`, `FrameProducer`) prevent large monoliths.
- **Dependency Inversion**: High-level orchestration depends on interfaces and receives concrete implementations via constructors.

## Concurrency & Performance
- Worker-thread pool for decoding and heavy image operations (Skia/Sharp) isolates CPU-intensive tasks.
- Streaming I/O avoids large in-memory buffers; frames are piped directly to FFmpeg with backpressure control.
- Optional frame-dropping heuristics maintain fluid 60 FPS when input uses variable delays or bursts.
- Metrics instrumentation (Pino + OpenTelemetry) tracks throughput, encode time, memory usage.

## Failure Handling & Fallbacks
- Validation ensures unsupported GIFs fallback to static PNG (first frame via `sharp`).
- Timeouts, retries and circuit breakers wrap remote downloads.
- Cache-first retrieval for repeat assets; TTL aligned with CDN caching headers.

## Production Considerations
- Pre-warm worker threads and load FFmpeg binary at startup to reduce cold start latency.
- Use ephemeral SSD or tmpfs for FFmpeg scratch space; clean up after encode.
- Monitor file sizes and automatically adjust CRF / bitrate to stay below Discord’s 8 MB limit (target <5 MB).
- Expose configuration via environment variables for codec selection, max resolution, concurrency and caching backends.
- Use CDN with brotli/gzip for static fallbacks and HTTP/3 for faster delivery.

