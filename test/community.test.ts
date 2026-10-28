import { describe, expect, test } from "vitest";
import {
  COMMUNITY_MAX_IMAGE_BYTES,
  COMMUNITY_MAX_VIDEO_BYTES,
  communityMediaUrl,
  isVideoMedia,
  mediaProblem,
} from "../src/lib/community";

describe("community media utilities", () => {
  test("accepts valid image formats within size limit", () => {
    const file = new File(["dummy content"], "photo.jpg", { type: "image/jpeg" });
    expect(mediaProblem(file)).toBeNull();

    const pngFile = new File(["png"], "photo.png", { type: "image/png" });
    expect(mediaProblem(pngFile)).toBeNull();

    const webpFile = new File(["webp"], "photo.webp", { type: "image/webp" });
    expect(mediaProblem(webpFile)).toBeNull();
  });

  test("accepts valid video formats within size limit", () => {
    const mp4File = new File(["video"], "clip.mp4", { type: "video/mp4" });
    expect(mediaProblem(mp4File)).toBeNull();

    const webmFile = new File(["video"], "clip.webm", { type: "video/webm" });
    expect(mediaProblem(webmFile)).toBeNull();

    const movFile = new File(["video"], "clip.mov", { type: "video/quicktime" });
    expect(mediaProblem(movFile)).toBeNull();
  });

  test("rejects unsupported file formats", () => {
    const pdfFile = new File(["pdf"], "doc.pdf", { type: "application/pdf" });
    expect(mediaProblem(pdfFile)).toBe("รองรับเฉพาะไฟล์รูปภาพ (JPG, PNG, WEBP, GIF) หรือวิดีโอ (MP4, WEBM, MOV)");

    const exeFile = new File(["exe"], "app.exe", { type: "application/x-msdownload" });
    expect(mediaProblem(exeFile)).toBe("รองรับเฉพาะไฟล์รูปภาพ (JPG, PNG, WEBP, GIF) หรือวิดีโอ (MP4, WEBM, MOV)");
  });

  test("rejects images larger than 10MB", () => {
    const bigFile = new File([], "large.jpg", { type: "image/jpeg" });
    Object.defineProperty(bigFile, "size", { value: COMMUNITY_MAX_IMAGE_BYTES + 1 });
    expect(mediaProblem(bigFile)).toBe("ไฟล์รูปภาพต้องมีขนาดไม่เกิน 10MB");
  });

  test("rejects videos larger than 50MB", () => {
    const bigVideo = new File([], "large.mp4", { type: "video/mp4" });
    Object.defineProperty(bigVideo, "size", { value: COMMUNITY_MAX_VIDEO_BYTES + 1 });
    expect(mediaProblem(bigVideo)).toBe("ไฟล์วิดีโอต้องมีขนาดไม่เกิน 50MB");
  });

  test("correctly identifies video media by file extension", () => {
    expect(isVideoMedia("user123/video.mp4")).toBe(true);
    expect(isVideoMedia("user123/video.webm")).toBe(true);
    expect(isVideoMedia("user123/video.mov")).toBe(true);
    expect(isVideoMedia("user123/VIDEO.MP4")).toBe(true);
    expect(isVideoMedia("user123/photo.jpg")).toBe(false);
    expect(isVideoMedia("user123/photo.png")).toBe(false);
    expect(isVideoMedia(null)).toBe(false);
    expect(isVideoMedia(undefined)).toBe(false);
  });

  test("generates public community media URL", () => {
    expect(communityMediaUrl(null)).toBeNull();
    expect(communityMediaUrl("https://example.com/test.jpg")).toBe("https://example.com/test.jpg");
    const path = "user-123/123456789.jpg";
    const url = communityMediaUrl(path);
    expect(url).toContain(`/storage/v1/object/public/community/${path}`);
  });
});
