import { dirname } from "node:path";
import { mkdir, stat, lstat, link, unlink } from "@toonflow/file";
import { resolveWorkspacePath } from "@/utils/workspace/files";
import { prepareWorkspaceFfmpeg } from "@/utils/ffmpeg";

function fail(message: string): never { throw new Error(message); }
async function runProcess(command: string[], signal?: AbortSignal) {
  const child = Bun.spawn(command, { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const abort = () => child.kill();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  signal?.removeEventListener("abort", abort);
  signal?.throwIfAborted();
  if (code !== 0) throw new Error(`FFmpeg: ${stderr.slice(-2000)}`);
  return stdout;
}
export async function mergeVideo(directory: string, clips: { path: string; mimeType: string }[], output: string, ratio: string, signal?: AbortSignal) {
  if (!clips.length || clips.length > 100 || !/^[1-9]\d{0,3}:[1-9]\d{0,3}$/.test(ratio)) fail("Danh sách clip hoặc tỷ lệ không hợp lệ.");
  const tools = await prepareWorkspaceFfmpeg();
  const destination = await resolveWorkspacePath(directory, output, true);
  await mkdir(dirname(destination.path), { recursive: true });
  async function probe(path: string) {
    return JSON.parse(await runProcess([tools.ffprobe, "-v", "error", "-show_streams", "-show_format", "-of", "json", path], signal)) as { streams: { codec_type: string }[]; format: { duration: string } };
  }
  // Final rename is the commit point. Recover a completed export after a crash.
  const exists = await lstat(destination.path).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return null; throw error; });
  if (exists?.isSymbolicLink()) fail("File xuất không được là liên kết.");
  if (!exists) {
    const args = [tools.ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin", "-y"];
    const details: { duration: number; audio: boolean }[] = [];
    for (const selected of clips) {
      const { path } = await resolveWorkspacePath(directory, selected.path);
      const info = await probe(path);
      const duration = Number(info.format.duration);
      if (!info.streams.some(stream => stream.codec_type === "video") || !Number.isFinite(duration) || duration <= 0) fail("Clip không phải video có thời lượng hợp lệ.");
      args.push("-i", path);
      details.push({ duration, audio: info.streams.some(stream => stream.codec_type === "audio") });
    }
    const audioIndices = details.map((detail, index) => detail.audio ? index : -1);
    let nextInput = details.length;
    for (const [index, detail] of details.entries()) if (!detail.audio) {
      audioIndices[index] = nextInput++;
      args.push("-f", "lavfi", "-t", String(detail.duration), "-i", "anullsrc=r=48000:cl=stereo");
    }
    const [ratioWidth, ratioHeight] = ratio.split(":").map(Number);
    const width = ratioWidth! >= ratioHeight! ? 1280 : Math.max(2, Math.round(1280 * ratioWidth! / ratioHeight! / 2) * 2);
    const height = ratioHeight! >= ratioWidth! ? 1280 : Math.max(2, Math.round(1280 * ratioHeight! / ratioWidth! / 2) * 2);
    const filters = details.flatMap((detail, index) => [
      `[${index}:v:0]scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p,setpts=PTS-STARTPTS[v${index}]`,
      `[${audioIndices[index]}:a:0]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,apad,atrim=duration=${detail.duration},asetpts=PTS-STARTPTS[a${index}]`,
    ]);
    filters.push(details.map((_, index) => `[v${index}][a${index}]`).join("") + `concat=n=${details.length}:v=1:a=1[v][a]`);
    const temporary = destination.path.replace(/\.mp4$/, ".partial.mp4");
    await runProcess([...args, "-filter_complex", filters.join(";"), "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-c:a", "aac", "-movflags", "+faststart", temporary], signal);
    const info = await probe(temporary);
    if (!info.streams.some(stream => stream.codec_type === "video") || !(Number(info.format.duration) > 0) || (await stat(temporary)).size === 0) fail("MP4 xuất chưa hợp lệ.");
    await link(temporary, destination.path);
    await unlink(temporary);
  }
  const info = await probe(destination.path);
  if (!info.streams.some(stream => stream.codec_type === "video") || !(Number(info.format.duration) > 0)) fail("MP4 đã lưu không hợp lệ.");
  return { path: output, mimeType: "video/mp4" };
}
