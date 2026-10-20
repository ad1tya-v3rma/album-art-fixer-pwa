
import "./style.css";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { toBlobURL } from "@ffmpeg/util";

const $ = id => document.getElementById(id);

let selectedFiles = [];
let reportRows = [];

$("files").addEventListener("change", event => {
    selectedFiles = [...event.target.files].filter(file =>
        /\.(flac|m4a)$/i.test(file.name)
    );
    $("message").textContent =
        `${selectedFiles.length} supported audio files selected.`;
});

function jpegType(bytes) {
    if (bytes.length < 4 || bytes[0] !== 255 || bytes[1] !== 216) {
        return "Non-JPEG";
    }

    for (let i = 2; i + 8 < bytes.length;) {
        if (bytes[i] !== 255) {
            i++;
            continue;
        }

        while (bytes[i] === 255) i++;
        const marker = bytes[i++];

        if (marker === 0xDA || marker === 0xD9) break;
        if (marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) continue;

        if (i + 1 >= bytes.length) break;
        const length = (bytes[i] << 8) | bytes[i + 1];

        if (length < 2 || i + length > bytes.length) break;

        if (marker === 0xC0) return "Baseline JPEG";
        if (marker === 0xC1) return "Extended sequential JPEG";
        if (marker === 0xC2) return "Progressive JPEG";

        i += length;
    }

    return "Unknown JPEG";
}

function drawResults(rows) {
    $("results").replaceChildren();

    if (!rows.length) {
        $("results").innerHTML = '<p class="muted">No supported files found.</p>';
        return;
    }

    for (const row of rows) {
        const item = document.createElement("div");
        item.className = "result";

        const name = document.createElement("div");
        name.className = "filename";
        name.textContent = row.file;

        const status = document.createElement("div");
        status.className = "status";
        status.textContent = row.status;

        item.append(name, status);
        $("results").append(item);
    }
}

/*async function scan() {
    if (!selectedFiles.length) {
        $("message").textContent = "Choose a music folder first.";
        return;
    }

    const scanButton = $("scan");

    scanButton.disabled = true;
    $("progress").classList.remove("hidden");
    $("bar").style.width = "0%";
    $("total").textContent = "0";
    $("needs").textContent = "0";
    $("errors").textContent = "0";
    $("report").disabled = true;

    reportRows = [];

    const dryRun = $("dryRun").checked;
    let ffmpeg = null;
    let loadedFiles = [];

    try {
        $("message").textContent = "Checking FFmpeg files…";

        // Resolve local files relative to the current Vite origin.
        const baseURL = new URL("ffmpeg/", window.location.href);

        const coreURL = new URL("ffmpeg-core.js", baseURL);
        const wasmURL = new URL("ffmpeg-core.wasm", baseURL);

        // Check both resources before attempting to initialize FFmpeg.
        for (const url of [coreURL, wasmURL]) {
            const response = await fetch(url);

            if (!response.ok) {
                throw new Error(
                    `Cannot load ${url.pathname}: HTTP ${response.status}. ` +
                    "Check the public/ffmpeg folder."
                );
            }

            if (url === coreURL) {
                const source = await response.text();

                if (!source.trim()) {
                    throw new Error("ffmpeg-core.js is empty.");
                }

                if (source.trimStart().startsWith("<")) {
                    throw new Error(
                        "ffmpeg-core.js returned HTML instead of JavaScript."
                    );
                }
            } else {
                const contentType =
                    response.headers.get("content-type") || "";

                if (contentType.includes("text/html")) {
                    throw new Error(
                        "ffmpeg-core.wasm returned HTML instead of WebAssembly."
                    );
                }
            }
        }

        $("message").textContent = "Initializing FFmpeg…";

        ffmpeg = new FFmpeg();

        ffmpeg.on("log", ({ message }) => {
            console.log("[FFmpeg]", message);
        });

        ffmpeg.on("progress", ({ progress }) => {
            if (Number.isFinite(progress)) {
                $("bar").style.width =
                    `${Math.round(progress * 100)}%`;
            }
        });

        // Use blob URLs to avoid the core import failing on a direct URL.
        try {
            await ffmpeg.load({
                coreURL: new URL(
                    "./ffmpeg/ffmpeg-core.js",
                    window.location.origin
                ).href,
                wasmURL: new URL(
                    "./ffmpeg/ffmpeg-core.wasm",
                    window.location.origin
                ).href
            });

            console.log("FFmpeg initialized successfully");
        } catch (error) {
            console.error("Original FFmpeg error:", error);
            throw error;
        }

        $("message").textContent = "Inspecting selected audio files…";

        for (let i = 0; i < selectedFiles.length; i++) {
            const file = selectedFiles[i];

            const row = {
                file: file.webkitRelativePath || file.name,
                status: "",
                artwork: "Not inspected",
                action: dryRun
                    ? "Scan only — no changes"
                    : "Conversion not implemented"
            };

            const extension =
                file.name.split(".").pop().toLowerCase();

            const inputName = `input_${i}.${extension}`;
            loadedFiles.push(inputName);

            try {
                const bytes = new Uint8Array(
                    await file.arrayBuffer()
                );

                await ffmpeg.writeFile(inputName, bytes);

                // Ask FFmpeg to inspect the container.
                // This does NOT classify embedded artwork.
                const exitCode = await ffmpeg.exec(
                    ["-hide_banner", "-i", inputName, "-f", "null", "-"],
                    30000
                );

                row.status = exitCode === 0
                    ? "File opened; artwork not yet inspected"
                    : "File inspected; check FFmpeg diagnostics";

                row.artwork = "Not inspected";

            } catch (error) {
                row.status =
                    `ERROR: ${error?.message || String(error)}`;
            } finally {
                try {
                    await ffmpeg.deleteFile(inputName);
                    loadedFiles = loadedFiles.filter(
                        name => name !== inputName
                    );
                } catch {
                    // Ignore cleanup errors.
                }
            }

            reportRows.push(row);

            $("bar").style.width =
                `${Math.round(
                    ((i + 1) / selectedFiles.length) * 100
                )}%`;

            $("total").textContent = String(reportRows.length);

            $("needs").textContent = String(
                reportRows.filter(row =>
                    row.status.includes("Needs conversion")
                ).length
            );

            $("errors").textContent = String(
                reportRows.filter(row =>
                    row.status.startsWith("ERROR")
                ).length
            );

            drawResults(reportRows);
        }

        $("report").disabled = false;
        $("message").textContent =
            `Finished inspecting ${reportRows.length} files. ` +
            "Embedded artwork conversion is not yet implemented.";

    } catch (error) {
        console.error("Processing engine error:", error);

        $("message").textContent =
            `Processing engine error: ${
                error?.message || String(error)
            }`;

    } finally {
        if (ffmpeg) {
            for (const name of loadedFiles) {
                try {
                    await ffmpeg.deleteFile(name);
                } catch {
                    // Ignore cleanup errors.
                }
            }

            try {
                ffmpeg.terminate();
            } catch {
                // Ignore termination errors.
            }
        }

        scanButton.disabled = false;
    }
}*/


async function scan() {
    if (!selectedFiles.length) {
        $("message").textContent = "Choose a music folder first.";
        return;
    }

    $("scan").disabled = true;
    $("progress").classList.remove("hidden");
    $("bar").style.width = "0%";
    $("total").textContent = "0";
    $("needs").textContent = "0";
    $("errors").textContent = "0";
    $("report").disabled = true;
    reportRows = [];

    let ffmpeg = null;
    const dryRun = $("dryRun").checked;

    try {
        const JSZip = (await import("jszip")).default;
        const zip = new JSZip();
        const { toBlobURL } = await import("@ffmpeg/util");

        const baseURL = new URL("./ffmpeg/", window.location.href);

        $("message").textContent = "Loading FFmpeg…";

        ffmpeg = new FFmpeg();
        let logs = [];

        ffmpeg.on("log", ({ message }) => {
            console.log("[FFmpeg]", message);
            logs.push(message);
        });

        ffmpeg.on("progress", ({ progress }) => {
            if (Number.isFinite(progress)) {
                $("bar").style.width =
                    `${Math.round(progress * 100)}%`;
            }
        });

        await ffmpeg.load({
            coreURL: await toBlobURL(
                new URL("ffmpeg-core.js", baseURL).href,
                "text/javascript"
            ),
            wasmURL: await toBlobURL(
                new URL("ffmpeg-core.wasm", baseURL).href,
                "application/wasm"
            )
        });

        function jpegType(bytes) {
            if (
                bytes.length < 4 ||
                bytes[0] !== 0xFF ||
                bytes[1] !== 0xD8
            ) {
                return "Non-JPEG artwork";
            }

            let pos = 2;

            while (pos < bytes.length - 3) {
                if (bytes[pos] !== 0xFF) {
                    pos++;
                    continue;
                }

                while (
                    pos < bytes.length &&
                    bytes[pos] === 0xFF
                    ) {
                    pos++;
                }

                if (pos >= bytes.length) break;

                const marker = bytes[pos++];

                if (marker === 0xD9 || marker === 0xDA) break;

                if (
                    marker === 0x01 ||
                    (marker >= 0xD0 && marker <= 0xD7)
                ) {
                    continue;
                }

                if (pos + 1 >= bytes.length) break;

                const length =
                    (bytes[pos] << 8) | bytes[pos + 1];

                if (
                    length < 2 ||
                    pos + length > bytes.length
                ) {
                    break;
                }

                if (marker === 0xC0) return "Baseline JPEG";
                if (marker === 0xC2) return "Progressive JPEG";

                if (
                    [
                        0xC1, 0xC3, 0xC5, 0xC6, 0xC7,
                        0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF
                    ].includes(marker)
                ) {
                    return "Other JPEG encoding";
                }

                pos += length;
            }

            return "Unknown JPEG encoding";
        }

        function relativePath(file) {
            return (
                file.webkitRelativePath || file.name
            ).replace(/\\/g, "/").replace(/^\/+/, "");
        }

        function imageExtension(codec) {
            const extensions = {
                mjpeg: "jpg",
                jpeg: "jpg",
                png: "png",
                webp: "webp",
                bmp: "bmp",
                gif: "gif",
                tiff: "tiff"
            };

            return extensions[codec.toLowerCase()] || null;
        }

        let convertedCount = 0;
        let unchangedCount = 0;
        let errorCount = 0;

        for (let i = 0; i < selectedFiles.length; i++) {
            const file = selectedFiles[i];
            const extension =
                file.name.split(".").pop().toLowerCase();

            const inputName = `input_${i}.${extension}`;
            const outputName = `repaired_${i}.${extension}`;
            const tempFiles = new Set([inputName, outputName]);

            const row = {
                file: relativePath(file),
                status: "",
                artwork: "Not inspected",
                action: ""
            };

            try {
                $("message").textContent =
                    `Inspecting ${i + 1}/${selectedFiles.length}: ${file.name}`;

                await ffmpeg.writeFile(
                    inputName,
                    new Uint8Array(await file.arrayBuffer())
                );

                // Inspect input streams using FFmpeg logs.
                logs = [];

                try {
                    await ffmpeg.exec([
                        "-hide_banner",
                        "-i", inputName
                    ]);
                } catch {
                    // An input-only command normally exits nonzero.
                }

                const streamMap = new Map();

                for (const line of logs) {
                    const match = line.match(
                        /Stream #0:(\d+): Video:\s*([^,\s]+)/i
                    );

                    if (match && /attached pic/i.test(line)) {
                        const index = Number(match[1]);
                        const codec = match[2].toLowerCase();
                        const ext = imageExtension(codec);

                        if (ext) {
                            streamMap.set(index, {
                                index,
                                codec,
                                ext
                            });
                        }
                    }
                }

                const pictures = [...streamMap.values()];

                if (pictures.length === 0) {
                    row.artwork = "No attached-picture stream detected";
                    row.status = "No artwork detected by FFmpeg";
                    row.action = dryRun
                        ? "Scan only"
                        : "Original included unchanged";

                    if (!dryRun) {
                        zip.file(relativePath(file), file);
                    }

                    unchangedCount++;
                } else {
                    const covers = [];

                    // Extract every detected cover.
                    for (let j = 0; j < pictures.length; j++) {
                        const picture = pictures[j];

                        const extracted =
                            `cover_${i}_${j}.${picture.ext}`;

                        const converted =
                            `baseline_${i}_${j}.jpg`;

                        tempFiles.add(extracted);
                        tempFiles.add(converted);

                        const extractCode = await ffmpeg.exec([
                            "-y",
                            "-i", inputName,
                            "-map", `0:${picture.index}`,
                            "-frames:v", "1",
                            "-c:v", "copy",
                            "-f", "image2",
                            "-update", "1",
                            extracted
                        ]);

                        if (extractCode !== 0) {
                            throw new Error(
                                `Could not extract cover ${j + 1}`
                            );
                        }

                        const bytes = await ffmpeg.readFile(extracted);
                        const originalType = jpegType(bytes);

                        const cover = {
                            input: extracted,
                            output: extracted,
                            originalType,
                            converted: false
                        };

                        if (originalType !== "Baseline JPEG") {
                            if (!dryRun) {
                                // Re-encode artwork only; audio is untouched.
                                const encodeCode = await ffmpeg.exec([
                                    "-y",
                                    "-i", extracted,
                                    "-frames:v", "1",
                                    "-vf", "format=yuvj420p",
                                    "-c:v", "mjpeg",
                                    "-q:v", "2",
                                    "-f", "image2",
                                    "-update", "1",
                                    converted
                                ]);

                                if (encodeCode !== 0) {
                                    throw new Error(
                                        `Could not convert cover ${j + 1}`
                                    );
                                }

                                const verified =
                                    jpegType(await ffmpeg.readFile(converted));

                                if (verified !== "Baseline JPEG") {
                                    throw new Error(
                                        `Cover ${j + 1} failed baseline verification`
                                    );
                                }

                                cover.output = converted;
                                cover.converted = true;
                            }
                        }

                        covers.push(cover);
                    }

                    const needsConversion = covers.some(
                        c => c.originalType !== "Baseline JPEG"
                    );

                    row.artwork = covers.map(
                        (c, j) =>
                            `Cover ${j + 1}: ${c.originalType}` +
                            (c.converted ? " → Baseline JPEG" : "")
                    ).join("; ");

                    if (dryRun) {
                        row.status = needsConversion
                            ? "Needs conversion"
                            : "Already compliant";

                        row.action = "Scan only — no changes made";

                        if (needsConversion) convertedCount++;
                        else unchangedCount++;
                    } else if (!needsConversion) {
                        row.status = "Already compliant";
                        row.action = "Original included unchanged";

                        zip.file(relativePath(file), file);
                        unchangedCount++;
                    } else {
                        // Copy audio and metadata; replace cover streams.
                        const args = ["-y", "-i", inputName];

                        for (const cover of covers) {
                            args.push("-i", cover.output);
                        }

                        args.push(
                            "-map", "0:a?",
                            "-map", "0:s?",
                            "-map", "0:d?"
                        );

                        for (let j = 0; j < covers.length; j++) {
                            args.push("-map", `${j + 1}:v:0`);
                        }

                        args.push(
                            "-map_metadata", "0",
                            "-map_chapters", "0",
                            "-c:a", "copy",
                            "-c:s", "copy",
                            "-c:d", "copy",
                            "-c:v", "copy"
                        );

                        for (let j = 0; j < covers.length; j++) {
                            args.push(
                                `-disposition:v:${j}`,
                                "attached_pic"
                            );
                        }

                        args.push(outputName);

                        const code = await ffmpeg.exec(args);

                        if (code !== 0) {
                            throw new Error(
                                `Could not re-embed artwork in ${file.name}`
                            );
                        }

                        zip.file(
                            relativePath(file),
                            await ffmpeg.readFile(outputName)
                        );

                        row.status = "Converted and re-embedded";
                        row.action = "Repaired copy added to ZIP";
                        convertedCount++;
                    }
                }
            } catch (error) {
                row.status =
                    `ERROR: ${error?.message || String(error)}`;

                row.action = "Original preserved in ZIP if download mode";
                errorCount++;

                if (!dryRun) {
                    zip.file(relativePath(file), file);
                }
            } finally {
                for (const name of tempFiles) {
                    try {
                        await ffmpeg.deleteFile(name);
                    } catch {}
                }
            }

            reportRows.push(row);

            $("total").textContent = String(reportRows.length);

            $("needs").textContent = String(
                reportRows.filter(r =>
                    r.status === "Needs conversion" ||
                    r.status === "Converted and re-embedded"
                ).length
            );

            $("errors").textContent = String(errorCount);

            $("bar").style.width =
                `${Math.round(
                    ((i + 1) / selectedFiles.length) * 100
                )}%`;

            drawResults(reportRows);
        }

        $("report").disabled = false;

        if (dryRun) {
            $("message").textContent =
                `Scan complete: ${reportRows.length} files; ` +
                `${convertedCount} need conversion; ` +
                `${unchangedCount} compliant; ${errorCount} errors. ` +
                "Uncheck Scan only to download repaired files.";
        } else {
            $("message").textContent = "Creating ZIP download…";

            const blob = await zip.generateAsync(
                {
                    type: "blob",
                    compression: "STORE"
                },
                metadata => {
                    $("bar").style.width =
                        `${Math.round(metadata.percent)}%`;
                }
            );

            const url = URL.createObjectURL(blob);
            const anchor = document.createElement("a");

            anchor.href = url;
            anchor.download = "album-art-repaired.zip";

            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();

            setTimeout(() => URL.revokeObjectURL(url), 60000);

            $("message").textContent =
                `Finished. Converted: ${convertedCount}; ` +
                `unchanged: ${unchangedCount}; errors: ${errorCount}. ` +
                "ZIP download started.";
        }
    } catch (error) {
        console.error("Processing engine error:", error);

        $("message").textContent =
            `Processing engine error: ${
                error?.message || String(error)
            }`;
    } finally {
        if (ffmpeg) {
            try {
                ffmpeg.terminate();
            } catch {}
        }

        $("scan").disabled = false;
    }
}

$("scan").addEventListener("click", scan);

$("report").addEventListener("click", () => {
    const columns = ["file", "status", "artwork", "action"];
    const csv = [
        columns.join(","),
        ...reportRows.map(row =>
            columns.map(key =>
                `"${String(row[key] ?? "").replaceAll('"', '""')}"`
            ).join(",")
        )
    ].join("\r\n");

    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "album-art-report.csv";
    link.click();
    URL.revokeObjectURL(url);
});
