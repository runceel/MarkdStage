## Native card image warning

```adaptive-card
{
  "type": "AdaptiveCard",
  "version": "1.5",
  "body": [
    { "type": "Image", "url": "https://example.invalid/blocked.png", "altText": "Unavailable image", "size": "Small" },
    { "type": "TextBlock", "text": "Safe content remains visible.", "wrap": true }
  ]
}
```
