using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text.Json;

namespace MarkdStageApp.Services;

internal sealed class VendorAssetProvider
{
    private readonly string _vendorDirectory;
    private readonly ConcurrentDictionary<string, byte[]> _assets = new();

    public VendorAssetProvider(string webRoot)
    {
        _vendorDirectory = Path.Combine(webRoot, "vendor");
    }

    public async Task<byte[]> GetAssetAsync(string name, CancellationToken cancellationToken)
    {
        if (name is not ("mermaid.min.js" or "adaptivecards.min.js"))
        {
            throw new ArgumentException("Unsupported bundled vendor asset.", nameof(name));
        }
        if (_assets.TryGetValue(name, out var cached))
        {
            return cached;
        }

        var manifestPath = Path.Combine(_vendorDirectory, "vendor-assets.lock.json");
        await using var manifestStream = File.OpenRead(manifestPath);
        using var manifest = await JsonDocument.ParseAsync(manifestStream, cancellationToken: cancellationToken);
        var asset = manifest.RootElement
            .GetProperty("assets")
            .GetProperty(name);

        using var output = new MemoryStream(asset.GetProperty("size").GetInt32());
        var index = 0;
        foreach (var chunk in asset.GetProperty("chunks").EnumerateArray())
        {
            var file = chunk.GetProperty("file").GetString()
                ?? throw new InvalidDataException($"{name} chunk file is missing.");
            if (Path.GetFileName(file) != file || file.Contains('\\') || file.Contains('/') ||
                chunk.GetProperty("index").GetInt32() != ++index)
            {
                throw new InvalidDataException($"{name} chunk entry is invalid.");
            }
            var expectedHash = chunk.GetProperty("sha256").GetString()
                ?? throw new InvalidDataException($"{name} chunk hash is missing.");
            var bytes = await File.ReadAllBytesAsync(
                Path.Combine(_vendorDirectory, file),
                cancellationToken);
            if (bytes.Length != chunk.GetProperty("size").GetInt32() ||
                bytes.Length > manifest.RootElement.GetProperty("chunkSize").GetInt32())
            {
                throw new InvalidDataException($"{file} failed size verification.");
            }
            VerifyHash(bytes, expectedHash, file);
            await output.WriteAsync(bytes, cancellationToken);
        }

        var combined = output.ToArray();
        if (index == 0 || combined.Length != asset.GetProperty("size").GetInt32())
        {
            throw new InvalidDataException($"{name} asset size does not match its manifest.");
        }

        VerifyHash(
            combined,
            asset.GetProperty("sha256").GetString()
                ?? throw new InvalidDataException($"{name} asset hash is missing."),
            name);
        return _assets.GetOrAdd(name, combined);
    }

    private static void VerifyHash(byte[] bytes, string expected, string name)
    {
        var actual = Convert.ToHexStringLower(SHA256.HashData(bytes));
        if (!actual.Equals(expected, StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidDataException($"{name} failed SHA-256 verification.");
        }
    }
}
