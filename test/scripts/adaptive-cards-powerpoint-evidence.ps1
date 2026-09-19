function Release-ReviewComObject($Value) {
    if ($null -ne $Value -and [Runtime.InteropServices.Marshal]::IsComObject($Value)) {
        [void][Runtime.InteropServices.Marshal]::ReleaseComObject($Value)
    }
}

function Write-ReviewJson($Value, [string]$Path) {
    [IO.File]::WriteAllText($Path, ($Value | ConvertTo-Json -Depth 60), [Text.UTF8Encoding]::new($false))
}

function Open-ReviewPresentation($Presentations, [string]$Path, [bool]$ReadOnly) {
    $fullPath = [IO.Path]::GetFullPath($Path)
    $existingReferences = [Collections.Generic.List[object]]::new()
    $existingIdentities = @{}
    try {
        for ($index = 1; $index -le $Presentations.Count; $index++) {
            $existing = $Presentations.Item($index)
            $existingReferences.Add($existing)
            if ([string]::Equals($existing.FullName, $fullPath, [StringComparison]::OrdinalIgnoreCase)) {
                throw "Refusing to reuse or close an already-open presentation: $fullPath"
            }
            $pointer = [Runtime.InteropServices.Marshal]::GetIUnknownForObject($existing)
            try { $existingIdentities[$pointer.ToInt64()] = $true }
            finally { [void][Runtime.InteropServices.Marshal]::Release($pointer) }
        }
        $readOnlyFlag = if ($ReadOnly) { -1 } else { 0 }
        $opened = $Presentations.Open($fullPath, $readOnlyFlag, 0, 0)
        $pointer = [Runtime.InteropServices.Marshal]::GetIUnknownForObject($opened)
        try { $reused = $existingIdentities.ContainsKey($pointer.ToInt64()) }
        finally { [void][Runtime.InteropServices.Marshal]::Release($pointer) }
        if ($reused) {
            Release-ReviewComObject $opened
            throw "PowerPoint reused a pre-existing presentation; it will not be closed: $fullPath"
        }
        return $opened
    } finally {
        foreach ($existing in $existingReferences) { Release-ReviewComObject $existing }
    }
}

function Close-ReviewPresentation($Presentation, [switch]$DiscardChanges) {
    if ($null -eq $Presentation) { return }
    try {
        if ($DiscardChanges) { $Presentation.Saved = -1 }
        $Presentation.Close()
    } finally { Release-ReviewComObject $Presentation }
}

function ConvertTo-ReviewText($Value) {
    if ($null -eq $Value) { return '' }
    if ($Value -is [string]) { return ($Value -replace "`r`n|`r|`v", "`n") }
    if ($null -ne $Value.paragraphs) {
        $paragraphs = @(
            foreach ($paragraph in $Value.paragraphs) {
                (@($paragraph.runs | ForEach-Object { [string]$_.text }) -join '')
            }
        )
        return (($paragraphs -join "`n") -replace "`r`n|`r|`v", "`n")
    }
    return ConvertTo-ReviewText $Value.text
}

function Get-ReviewBounds($Value) {
    $width = if ($null -ne $Value.width) { $Value.width } else { $Value.w }
    $height = if ($null -ne $Value.height) { $Value.height } else { $Value.h }
    $bounds = [ordered]@{ x = $Value.x; y = $Value.y; width = $width; height = $height }
    foreach ($key in @('x', 'y', 'width', 'height')) {
        if ($null -eq $bounds[$key] -or [double]::IsNaN([double]$bounds[$key]) -or
            [double]::IsInfinity([double]$bounds[$key])) {
            throw "Invalid model $key at $($Value.path)."
        }
        $bounds[$key] = [double]$bounds[$key]
    }
    return $bounds
}

function Get-ReviewFontSizePx($Run) {
    $value = $Run.fontSize
    $unit = if ($Run.fontSizeUnit) { $Run.fontSizeUnit } else { 'px' }
    if ($null -ne $Run.fontSizePx) { $value = $Run.fontSizePx; $unit = 'px' }
    elseif ($null -ne $Run.fontSizePt) { $value = $Run.fontSizePt; $unit = 'pt' }
    if ($null -eq $value) { return 24.0 }
    if ($value -is [string] -and $value -match '^(\d+(?:\.\d+)?)\s*(px|pt)$') {
        $value = [double]::Parse($Matches[1], [Globalization.CultureInfo]::InvariantCulture)
        $unit = $Matches[2]
    }
    $points = if ($unit -eq 'pt') { [double]$value } else { [double]$value * 0.75 }
    return [Math]::Floor($points * 100 + 0.5) / 75
}

function Get-ReviewExpectedObjects($ModelSlide) {
    $objects = [Collections.Generic.List[object]]::new()
    $sequence = 0
    $fallbackIndex = 0
    foreach ($fallback in @($ModelSlide.fallbacks | Where-Object { $null -ne $_ })) {
        $currentIndex = $fallbackIndex++
        if ($fallback.artwork -eq $false) { continue }
        $modelBounds = Get-ReviewBounds $fallback
        $left = [Math]::Max(0.0, [double]$modelBounds.x)
        $top = [Math]::Max(0.0, [double]$modelBounds.y)
        $right = [Math]::Min(1280.0, [double]($modelBounds.x + $modelBounds.width))
        $bottom = [Math]::Min(720.0, [double]($modelBounds.y + $modelBounds.height))
        if ($right -le $left -or $bottom -le $top) { throw "Empty fallback capture: $($fallback.path)" }
        if ($fallback.type -in @('adaptive-card', 'mermaid')) {
            $left = [Math]::Floor($left); $top = [Math]::Floor($top)
            $right = [Math]::Ceiling($right); $bottom = [Math]::Ceiling($bottom)
        }
        $order = if ($null -ne $fallback.zOrder) { [double]$fallback.zOrder } else { [double]::PositiveInfinity }
        $objects.Add([pscustomobject]@{
            kind = 'fallback'; type = 'image'; sequence = $sequence++; sortOrder = $order
            modelIndex = $null; fallbackIndex = $currentIndex; zOrder = $fallback.zOrder
            isCard = $fallback.type -eq 'adaptive-card'; fallbackType = $fallback.type
            path = $fallback.path; sourcePath = $fallback.sourcePath; sourceType = $fallback.sourceType
            reason = $fallback.reason; captureId = $fallback.captureId
            expectedName = "$(if ($fallback.type) { $fallback.type } else { 'Fallback' }) artwork"
            modelBounds = $modelBounds
            bounds = [ordered]@{ x = $left; y = $top; width = $right - $left; height = $bottom - $top }
            placementTransform = 'viewport-clipped capture; outward-rounded for adaptive-card/mermaid'
            text = ''; rows = @()
        })
    }
    $elementIndex = 0
    foreach ($element in @($ModelSlide.elements | Where-Object { $null -ne $_ })) {
        if ($element.type -notin @('text', 'shape', 'image', 'table', 'connector')) {
            throw "Unrecognized review model element type '$($element.type)' at $($element.path)."
        }
        $modelBounds = Get-ReviewBounds $element
        $bounds = Get-ReviewBounds $element
        $transform = 'none'
        if ($element.type -eq 'image' -and $element.fit -in @('contain', 'scale-down') -and
            $element.naturalWidth -gt 0 -and $element.naturalHeight -gt 0) {
            $scale = [Math]::Min($bounds.width / $element.naturalWidth, $bounds.height / $element.naturalHeight)
            if ($element.fit -eq 'scale-down') { $scale = [Math]::Min(1.0, [double]$scale) }
            $width = $element.naturalWidth * $scale; $height = $element.naturalHeight * $scale
            $bounds.x += ($bounds.width - $width) / 2; $bounds.y += ($bounds.height - $height) / 2
            $bounds.width = $width; $bounds.height = $height
            $transform = 'preparePptxPackageModel image containment'
        }
        if ($element.type -eq 'text') {
            $inset = 0.0
            foreach ($paragraph in @($element.paragraphs | Where-Object { $_.bullet -and $_.runs.Count -gt 0 })) {
                $offset = if ($null -ne $paragraph.bulletOffsetPx) { [double]$paragraph.bulletOffsetPx } else {
                    (@($paragraph.runs | ForEach-Object { Get-ReviewFontSizePx $_ }) | Measure-Object -Maximum).Maximum
                }
                $inset = [Math]::Max($inset, $offset)
            }
            if ($inset -gt 0) {
                $bounds.x -= $inset; $bounds.width += $inset
                $transform = 'writer bullet hanging inset'
            }
        }
        $rows = @(
            foreach ($row in @($element.rows | Where-Object { $null -ne $_ })) {
                [pscustomobject]@{ height = $row.height; cells = @($row.cells | ForEach-Object { ConvertTo-ReviewText $_ }) }
            }
        )
        $order = if ($null -ne $element.zOrder) { [double]$element.zOrder } else { [double]::PositiveInfinity }
        $objects.Add([pscustomobject]@{
            kind = 'element'; type = $element.type; sequence = $sequence++; sortOrder = $order
            modelIndex = $elementIndex++; fallbackIndex = $null; zOrder = $element.zOrder
            isCard = $null -ne $element.adaptiveCard; fallbackType = $null
            path = $element.path; sourcePath = $element.adaptiveCard.sourcePath; sourceType = $element.adaptiveCard.sourceType
            reason = $null; captureId = $null; expectedName = $null
            modelBounds = $modelBounds; bounds = $bounds; placementTransform = $transform
            text = ConvertTo-ReviewText $element; rows = $rows
        })
    }
    return @($objects | Sort-Object sortOrder, sequence)
}

function Get-ReviewPackageIdentities($Archive, [int]$Page) {
    $entry = $Archive.GetEntry("ppt/slides/slide$Page.xml")
    if ($null -eq $entry) { throw "Missing slide$Page.xml in the source PPTX." }
    $reader = [IO.StreamReader]::new($entry.Open())
    try {
        $xml = [xml]::new()
        $xml.XmlResolver = $null
        $xml.LoadXml($reader.ReadToEnd())
    } finally { $reader.Dispose() }
    $order = 0
    foreach ($node in $xml.SelectNodes('//*[local-name()="spTree"]/*')) {
        if ($node.LocalName -notin @('sp', 'pic', 'graphicFrame', 'grpSp', 'cxnSp')) { continue }
        $identity = $node.SelectSingleNode('.//*[local-name()="cNvPr"]')
        if ($null -eq $identity) { throw "Slide $Page has a shape without a package identity." }
        [pscustomobject]@{
            id = [int]$identity.GetAttribute('id'); name = $identity.GetAttribute('name')
            xmlType = $node.LocalName; order = ++$order
        }
    }
}

function Get-ReviewFill($Shape) {
    $fill = $null; $color = $null
    try {
        $fill = $Shape.Fill
        $color = $fill.ForeColor
        return [pscustomobject]@{
            visible = [int]$fill.Visible; type = [int]$fill.Type
            rgb = [int]$color.RGB; transparency = [double]$fill.Transparency
        }
    } catch { return $null }
    finally { Release-ReviewComObject $color; Release-ReviewComObject $fill }
}

function Get-ReviewTextFrame($Shape) {
    if ($Shape.HasTextFrame -ne -1) { return $null }
    $frame = $null; $range = $null
    try {
        $frame = $Shape.TextFrame
        $range = $frame.TextRange
        $result = [ordered]@{
            hasText = $frame.HasText -eq -1; text = ConvertTo-ReviewText ([string]$range.Text)
            marginsPx = @{
                left = $frame.MarginLeft * 4 / 3; right = $frame.MarginRight * 4 / 3
                top = $frame.MarginTop * 4 / 3; bottom = $frame.MarginBottom * 4 / 3
            }
            wordWrap = [int]$frame.WordWrap; autoSize = [int]$frame.AutoSize
            rangeBoundsPx = $null
            rangeBoundsMeaning = 'PowerPoint TextRange rectangle, not a glyph baseline or visual acceptance measurement.'
        }
        try {
            $result.rangeBoundsPx = @{
                x = $range.BoundLeft * 4 / 3; y = $range.BoundTop * 4 / 3
                width = $range.BoundWidth * 4 / 3; height = $range.BoundHeight * 4 / 3
            }
        } catch { $result.rangeBoundsUnavailable = $_.Exception.Message }
        return [pscustomobject]$result
    } finally { Release-ReviewComObject $range; Release-ReviewComObject $frame }
}

function Get-ReviewShapeSnapshot($Shape, [int]$Index) {
    $bounds = [ordered]@{
        x = $Shape.Left * 4 / 3; y = $Shape.Top * 4 / 3
        width = $Shape.Width * 4 / 3; height = $Shape.Height * 4 / 3
    }
    $textFrame = Get-ReviewTextFrame $Shape
    $result = [ordered]@{
        index = $Index; id = [int]$Shape.Id; name = [string]$Shape.Name
        type = [int]$Shape.Type; z = [int]$Shape.ZOrderPosition
        bounds = $bounds; rotation = [double]$Shape.Rotation
        text = if ($textFrame) { $textFrame.text } else { '' }
        hasTextFrame = $Shape.HasTextFrame -eq -1; textFrame = $textFrame
        hasTable = $Shape.HasTable -eq -1; table = $null
        fill = Get-ReviewFill $Shape; pictureFormat = $null
    }
    if ($result.type -in @(11, 13, 28, 29)) {
        $picture = $null
        try {
            $picture = $Shape.PictureFormat
            $result.pictureFormat = [ordered]@{
                cropLeftPoints = [double]$picture.CropLeft; cropRightPoints = [double]$picture.CropRight
                cropTopPoints = [double]$picture.CropTop; cropBottomPoints = [double]$picture.CropBottom
            }
        } catch { $result.pictureFormatUnavailable = $_.Exception.Message }
        finally { Release-ReviewComObject $picture }
    }
    if ($result.hasTable) {
        $table = $null; $tableRows = $null; $columns = $null
        try {
            $table = $Shape.Table; $tableRows = $table.Rows; $columns = $table.Columns
            $rows = @(
                for ($row = 1; $row -le $tableRows.Count; $row++) {
                    $cells = @(
                        for ($column = 1; $column -le $columns.Count; $column++) {
                            $cell = $null; $cellShape = $null
                            try {
                                $cell = $table.Cell($row, $column); $cellShape = $cell.Shape
                                $cellFrame = Get-ReviewTextFrame $cellShape
                                [pscustomobject]@{
                                    row = $row; column = $column; text = $cellFrame.text; textFrame = $cellFrame
                                    fill = Get-ReviewFill $cellShape
                                    bounds = @{
                                        x = $cellShape.Left * 4 / 3; y = $cellShape.Top * 4 / 3
                                        width = $cellShape.Width * 4 / 3; height = $cellShape.Height * 4 / 3
                                    }
                                }
                            } finally { Release-ReviewComObject $cellShape; Release-ReviewComObject $cell }
                        }
                    )
                    [pscustomobject]@{ cells = $cells }
                }
            )
            $result.table = @{ rowCount = [int]$tableRows.Count; columnCount = [int]$columns.Count; rows = $rows }
            $result.text = (@($rows | ForEach-Object { $_.cells | ForEach-Object text }) -join "`n")
        } finally {
            Release-ReviewComObject $columns; Release-ReviewComObject $tableRows; Release-ReviewComObject $table
        }
    }
    return [pscustomobject]$result
}

function Get-ReviewSlideSnapshots($Slide) {
    $shapes = $Slide.Shapes
    try {
        for ($index = 1; $index -le $shapes.Count; $index++) {
            $shape = $shapes.Item($index)
            try { Get-ReviewShapeSnapshot $shape $index }
            finally { Release-ReviewComObject $shape }
        }
    } finally { Release-ReviewComObject $shapes }
}

function Test-ReviewShapeType($Actual, [string]$ExpectedType) {
    switch ($ExpectedType) {
        'text' { return $Actual.type -in @(1, 17) -and $Actual.hasTextFrame -and -not $Actual.hasTable }
        'shape' { return $Actual.type -in @(1, 5) -and -not $Actual.hasTable }
        'image' { return $Actual.type -in @(11, 13, 28, 29) }
        'table' { return $Actual.type -eq 19 -and $Actual.hasTable }
        'connector' { return $Actual.type -in @(5, 9) -and -not $Actual.hasTable }
    }
    return $false
}

function Measure-ReviewPlacement($Expected, $Actual, [string]$Type) {
    $deltas = [ordered]@{}
    foreach ($key in @('x', 'y', 'width', 'height')) {
        $deltas[$key] = [Math]::Abs($Actual[$key] - $Expected[$key])
    }
    $edges = [ordered]@{
        left = $deltas.x; top = $deltas.y
        right = [Math]::Abs(($Actual.x + $Actual.width) - ($Expected.x + $Expected.width))
        bottom = [Math]::Abs(($Actual.y + $Actual.height) - ($Expected.y + $Expected.height))
    }
    # Office can include a table grid's half-stroke in its outside edges. Other objects do not get this allowance.
    $tolerance = if ($Type -eq 'table') { 2.0 } else { 0.02 }
    $measured = if ($Type -eq 'table') { $edges.Values } else { $deltas.Values }
    $maximum = ($measured | Measure-Object -Maximum).Maximum
    return [pscustomobject]@{
        deltaPx = $deltas; edgeDeltaPx = $edges; maximumDeltaPx = $maximum
        tolerancePx = $tolerance; compared = if ($Type -eq 'table') { 'outside edges' } else { 'x/y/width/height' }
        passed = $maximum -le $tolerance
    }
}

function Get-ReviewPageEvidence($ModelSlide, $Identities, $Snapshots, [int]$Page) {
    $expected = @(Get-ReviewExpectedObjects $ModelSlide)
    $issues = [Collections.Generic.List[string]]::new()
    $missing = [Collections.Generic.List[object]]::new()
    $mapped = [Collections.Generic.List[object]]::new()
    $used = @{}
    $actualById = @{}
    foreach ($actual in $Snapshots) {
        if ($actualById.ContainsKey($actual.id)) { $issues.Add("Duplicate COM shape ID $($actual.id).") }
        $actualById[$actual.id] = $actual
    }
    if ($expected.Count -ne $Identities.Count) {
        $issues.Add("Model/package shape count mismatch: $($expected.Count) expected, $($Identities.Count) package identities.")
    }
    if ($expected.Count -ne $Snapshots.Count) {
        $issues.Add("Model/COM shape count mismatch: $($expected.Count) expected, $($Snapshots.Count) actual COM shapes.")
    }
    $nativeCounts = [ordered]@{ text = 0; shape = 0; image = 0; table = 0; connector = 0; total = 0 }
    $expectedNativeCounts = [ordered]@{ text = 0; shape = 0; image = 0; table = 0; connector = 0; total = 0 }
    $rasterCount = 0; $expectedRasterCount = 0; $allFallbackCount = 0; $expectedFallbackCount = 0
    $maximumNativeDelta = 0.0; $maximumRasterDelta = 0.0
    for ($index = 0; $index -lt $expected.Count; $index++) {
        $item = $expected[$index]
        $descriptor = [ordered]@{
            kind = $item.kind; type = $item.type; isCard = $item.isCard
            modelIndex = $item.modelIndex; fallbackIndex = $item.fallbackIndex
            sourcePath = if ($item.sourcePath) { $item.sourcePath } else { $item.path }
            sourceType = $item.sourceType; path = $item.path; zOrder = $item.zOrder
            fallbackType = $item.fallbackType; reason = $item.reason; captureId = $item.captureId
            modelBounds = $item.modelBounds; bounds = $item.bounds; placementTransform = $item.placementTransform
            text = $item.text; rows = $item.rows
        }
        if ($item.kind -eq 'element' -and $item.isCard) {
            $expectedNativeCounts[$item.type]++; $expectedNativeCounts.total++
        }
        if ($item.kind -eq 'fallback') {
            $expectedFallbackCount++
            if ($item.isCard) { $expectedRasterCount++ }
        }
        if ($index -ge $Identities.Count -or -not $actualById.ContainsKey($Identities[$index].id)) {
            $missing.Add($descriptor)
            $issues.Add("Missing COM $($item.type) for $($item.path).")
            continue
        }
        $identity = $Identities[$index]
        $actual = $actualById[$identity.id]
        $used[$identity.id] = $true
        $typeMatches = Test-ReviewShapeType $actual $item.type
        $textMatches = $true
        if ($item.type -in @('text', 'shape')) { $textMatches = $actual.text -ceq $item.text }
        if ($item.type -eq 'table') {
            $textMatches = $actual.hasTable -and $actual.table.rowCount -eq $item.rows.Count
            if ($textMatches) {
                for ($row = 0; $row -lt $item.rows.Count; $row++) {
                    if ($actual.table.columnCount -ne $item.rows[$row].cells.Count) { $textMatches = $false; break }
                    for ($column = 0; $column -lt $item.rows[$row].cells.Count; $column++) {
                        if ($actual.table.rows[$row].cells[$column].text -cne $item.rows[$row].cells[$column]) {
                            $textMatches = $false
                        }
                    }
                }
            }
        }
        $identityMatches = $actual.name -ceq $identity.name -and $actual.z -eq $identity.order
        if ($item.kind -eq 'fallback' -and $actual.name -cne $item.expectedName) { $identityMatches = $false }
        $placement = Measure-ReviewPlacement $item.bounds $actual.bounds $item.type
        if (-not $identityMatches) { $issues.Add("COM/package name or z-order mismatch at $($item.path) (ID $($actual.id)).") }
        if (-not $typeMatches) { $issues.Add("Expected actual COM $($item.type) at $($item.path), found type $($actual.type).") }
        if (-not $textMatches) { $issues.Add("COM text or table cell content mismatch at $($item.path) (ID $($actual.id)).") }
        if (-not $placement.passed) {
            $issues.Add("COM placement mismatch at $($item.path): $($placement.maximumDeltaPx) px exceeds $($placement.tolerancePx) px.")
        }
        if ($item.kind -eq 'element' -and $item.isCard) {
            if ($typeMatches) { $nativeCounts[$item.type]++; $nativeCounts.total++ }
            $maximumNativeDelta = [Math]::Max($maximumNativeDelta, $placement.maximumDeltaPx)
        }
        if ($item.kind -eq 'fallback' -and $typeMatches -and $identityMatches) {
            $allFallbackCount++
            if ($item.isCard) {
                $rasterCount++
                $maximumRasterDelta = [Math]::Max($maximumRasterDelta, $placement.maximumDeltaPx)
            }
        }
        $mapped.Add([pscustomobject]@{
            page = $Page; expected = [pscustomobject]$descriptor; packageIdentity = $identity
            actual = $actual; typeMatches = $typeMatches; textMatches = $textMatches
            identityMatches = $identityMatches; placement = $placement
        })
    }
    $extra = @($Snapshots | Where-Object { -not $used.ContainsKey($_.id) })
    foreach ($actual in $extra) { $issues.Add("Extra COM shape ID $($actual.id), '$($actual.name)'.") }
    if ($rasterCount -ne $expectedRasterCount) { $issues.Add("Adaptive Card raster count: $rasterCount actual, $expectedRasterCount expected visible subtrees.") }
    if ($allFallbackCount -ne $expectedFallbackCount) { $issues.Add("All-fallback raster count: $allFallbackCount actual, $expectedFallbackCount expected.") }
    return [pscustomobject]@{
        page = $Page; shapes = @($Snapshots); mappings = @($mapped); adaptiveCards = @($ModelSlide.adaptiveCards)
        expectedShapeCount = $expected.Count; shapeCount = $Snapshots.Count
        nativeCounts = $nativeCounts; expectedNativeCounts = $expectedNativeCounts
        rasterCount = $rasterCount; expectedRasterCount = $expectedRasterCount
        allFallbackCount = $allFallbackCount; expectedFallbackCount = $expectedFallbackCount
        invisibleFallbacks = @($ModelSlide.fallbacks | Where-Object { $_.artwork -eq $false })
        nativePlacementMaximumDeltaPx = $maximumNativeDelta; cardPlacementMaximumDeltaPx = $maximumRasterDelta
        missing = @($missing); extra = $extra; errors = @($issues); measuredChecksPassed = $issues.Count -eq 0
        render = $null; comparison = $null
    }
}

function Assert-ReviewPngSize([string]$Path) {
    $image = [Drawing.Image]::FromFile($Path)
    try {
        if ($image.Width -ne 1280 -or $image.Height -ne 720) { throw "Expected a 1280x720 render: $Path" }
    } finally { $image.Dispose() }
}

function New-ReviewComparison([string]$Browser, [string]$PowerPoint, [string]$Destination) {
    Assert-ReviewPngSize $Browser
    Assert-ReviewPngSize $PowerPoint
    $original = $null; $rendered = $null; $bitmap = $null; $graphics = $null
    try {
        $original = [Drawing.Image]::FromFile($Browser)
        $rendered = [Drawing.Image]::FromFile($PowerPoint)
        $bitmap = [Drawing.Bitmap]::new(2560, 720)
        $graphics = [Drawing.Graphics]::FromImage($bitmap)
        $graphics.DrawImageUnscaled($original, 0, 0)
        $graphics.DrawImageUnscaled($rendered, 1280, 0)
        $bitmap.Save($Destination, [Drawing.Imaging.ImageFormat]::Png)
    } finally {
        if ($graphics) { $graphics.Dispose() }; if ($bitmap) { $bitmap.Dispose() }
        if ($original) { $original.Dispose() }; if ($rendered) { $rendered.Dispose() }
    }
}

function Get-ReviewShapeByIdentity($Slides, $Identity) {
    $slide = $null; $shapes = $null
    try {
        $slide = $Slides.Item([int]$Identity.page); $shapes = $slide.Shapes
        for ($index = 1; $index -le $shapes.Count; $index++) {
            $shape = $shapes.Item($index)
            if ($shape.Id -eq $Identity.id) {
                if ($shape.Name -cne $Identity.name -or $shape.Type -ne $Identity.comType) {
                    Release-ReviewComObject $shape
                    throw "Existing shape identity changed on slide $($Identity.page), ID $($Identity.id)."
                }
                return $shape
            }
            Release-ReviewComObject $shape
        }
        throw "Existing shape missing on slide $($Identity.page), ID $($Identity.id)."
    } finally { Release-ReviewComObject $shapes; Release-ReviewComObject $slide }
}

function Set-ReviewShapeText($Shape, [string]$Text) {
    $frame = $null; $range = $null
    try {
        $frame = $Shape.TextFrame; $range = $frame.TextRange
        $range.Text = $Text
    } finally { Release-ReviewComObject $range; Release-ReviewComObject $frame }
}

function Set-ReviewShapeFill($Shape, [int]$Rgb) {
    $fill = $null; $color = $null
    try {
        $fill = $Shape.Fill
        $fill.Solid(); $fill.Visible = -1; $fill.Transparency = 0
        $color = $fill.ForeColor; $color.RGB = $Rgb
    } finally { Release-ReviewComObject $color; Release-ReviewComObject $fill }
}

function Get-ReviewEditValues($Snapshot, [string]$Operation) {
    switch ($Operation) {
        'text' { return [ordered]@{ text = $Snapshot.text } }
        'position' { return [ordered]@{ x = $Snapshot.bounds.x; y = $Snapshot.bounds.y } }
        'image' {
            if ($null -eq $Snapshot.pictureFormat) { throw 'The existing native image has no readable PictureFormat crop properties.' }
            return [ordered]@{
                cropLeftPoints = $Snapshot.pictureFormat.cropLeftPoints
                cropRightPoints = $Snapshot.pictureFormat.cropRightPoints
                cropTopPoints = $Snapshot.pictureFormat.cropTopPoints
                cropBottomPoints = $Snapshot.pictureFormat.cropBottomPoints
                widthPx = $Snapshot.bounds.width; heightPx = $Snapshot.bounds.height
            }
        }
        'fill' {
            if ($null -eq $Snapshot.fill) { throw 'The existing native shape has no readable fill.' }
            return [ordered]@{
                rgb = $Snapshot.fill.rgb; fillType = $Snapshot.fill.type
                fillVisible = $Snapshot.fill.visible; transparency = $Snapshot.fill.transparency
            }
        }
        'table' {
            if (-not $Snapshot.hasTable) { throw 'The existing object is not an actual PowerPoint table.' }
            $cell = $Snapshot.table.rows[0].cells[0]
            if ($null -eq $cell.fill) { throw 'The existing table cell has no readable fill.' }
            return [ordered]@{
                row = 1; column = 1; text = $cell.text; rgb = $cell.fill.rgb
                fillType = $cell.fill.type; fillVisible = $cell.fill.visible; transparency = $cell.fill.transparency
            }
        }
    }
}

function Test-ReviewEditValues($Actual, $Expected) {
    foreach ($key in $Expected.Keys) {
        $tolerance = 0.0
        if ($key -in @('x', 'y', 'widthPx', 'heightPx')) { $tolerance = 0.02 }
        if ($key -like 'crop*Points') { $tolerance = 0.015 }
        if ($key -eq 'transparency') { $tolerance = 0.0001 }
        $passed = if ($tolerance -gt 0) {
            $null -ne $Actual[$key] -and [Math]::Abs([double]$Actual[$key] - [double]$Expected[$key]) -le $tolerance
        } else { $Actual[$key] -ceq $Expected[$key] }
        [pscustomobject]@{ property = $key; expected = $Expected[$key]; actual = $Actual[$key]; tolerance = $tolerance; passed = $passed }
    }
}

function Test-ReviewInventory($Slides, $Pages, [string]$Stage) {
    $checks = [Collections.Generic.List[object]]::new()
    $checks.Add([pscustomobject]@{
        stage = $Stage; check = 'slideCount'; expected = $Pages.Count
        actual = [int]$Slides.Count; passed = $Pages.Count -eq $Slides.Count
    })
    foreach ($page in $Pages) {
        $slide = $null; $shapes = $null
        try {
            $slide = $Slides.Item([int]$page.page); $shapes = $slide.Shapes
            $actual = @(
                for ($index = 1; $index -le $shapes.Count; $index++) {
                    $shape = $shapes.Item($index)
                    try { "$($shape.Id):$($shape.Type):$($shape.Name)" }
                    finally { Release-ReviewComObject $shape }
                }
            )
            $expected = @($page.shapes | ForEach-Object { "$($_.id):$($_.type):$($_.name)" })
            $checks.Add([pscustomobject]@{
                stage = $Stage; check = 'unchangedExistingShapeInventory'; page = $page.page
                expected = $expected; actual = $actual; passed = ($actual -join "`n") -ceq ($expected -join "`n")
            })
        } finally { Release-ReviewComObject $shapes; Release-ReviewComObject $slide }
    }
    return @($checks)
}

function Invoke-ReviewEditability($Presentations, [string]$Source, [string]$SourceSha256, [string]$Directory, $Pages, $Engine) {
    $issues = [Collections.Generic.List[string]]::new()
    $operations = [Collections.Generic.List[object]]::new()
    $report = [ordered]@{
        schemaVersion = 1; engine = $Engine; sourcePptx = $Source; originalSha256Before = $SourceSha256
        originalSha256After = $null; originalUnchanged = $false
        copyPptx = $null; copySha256Before = $null; copySha256AfterSave = $null; copySha256AfterReopen = $null
        copyIsDisposable = $true; reopenedReadOnly = $false; saved = $false
        requiredNativeTypes = @('text', 'shape', 'image', 'table')
        requiredOperations = @('text', 'fill', 'position', 'image', 'table')
        operations = @(); inventoryChecks = @(); outputPngPaths = @(); errors = @(); measuredChecksPassed = $false
        visualAcceptance = 'Not inferred from edit persistence or geometry; edited renders are evidence for separate review.'
    }
    $deck = $null; $slides = $null; $reopened = $null; $reopenedSlides = $null
    try {
        $candidates = @($Pages | ForEach-Object mappings | Where-Object {
            $_.expected.isCard -and $_.expected.kind -eq 'element' -and
            $_.typeMatches -and $_.textMatches -and $_.identityMatches
        })
        $representatives = @{
            text = $candidates | Where-Object { $_.expected.type -eq 'text' -and $_.actual.text.Length -gt 0 } |
                Sort-Object { $_.actual.bounds.width } -Descending | Select-Object -First 1
            shape = $candidates | Where-Object {
                $_.expected.type -eq 'shape' -and $_.actual.fill.visible -eq -1 -and
                $_.actual.fill.type -eq 1 -and $_.actual.fill.transparency -lt 1
            } | Sort-Object { $_.actual.bounds.width * $_.actual.bounds.height } -Descending | Select-Object -First 1
            image = $candidates | Where-Object { $_.expected.type -eq 'image' -and $null -ne $_.actual.pictureFormat } |
                Sort-Object { $_.actual.bounds.width * $_.actual.bounds.height } -Descending | Select-Object -First 1
            table = $candidates | Where-Object { $_.expected.type -eq 'table' -and $_.actual.hasTable } | Select-Object -First 1
        }
        foreach ($type in $report.requiredNativeTypes) {
            if ($null -eq $representatives[$type]) { $issues.Add("Missing representative existing card-native $type; complete fixtures require all four native types.") }
        }
        $runDirectory = Join-Path (Join-Path $Directory 'editability') ("run-" + [Guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $runDirectory | Out-Null
        $copy = Join-Path $runDirectory 'edited.pptx'
        [IO.File]::Copy($Source, $copy, $false)
        $copyItem = Get-Item -LiteralPath $copy
        $copyItem.IsReadOnly = $false
        $report.copyPptx = $copy
        $report.copySha256Before = (Get-FileHash -LiteralPath $copy -Algorithm SHA256).Hash
        if ($report.copySha256Before -ne $SourceSha256) { throw 'The disposable copy does not match the original source SHA256.' }
        $deck = Open-ReviewPresentation $Presentations $copy $false
        if ($deck.ReadOnly -ne 0) { throw 'The disposable editability copy was not opened writable.' }
        $slides = $deck.Slides
        foreach ($operation in $report.requiredOperations) {
            $type = switch ($operation) { 'fill' { 'shape' }; 'position' { 'text' }; default { $operation } }
            $representative = $representatives[$type]
            if ($null -eq $representative) { continue }
            $identity = [pscustomobject]@{
                sourcePptx = $Source; sourceSha256 = $SourceSha256; page = $representative.page
                id = $representative.actual.id; name = $representative.actual.name; comType = $representative.actual.type
                z = $representative.actual.z; nativeType = $type; modelIndex = $representative.expected.modelIndex
                sourcePath = $representative.expected.sourcePath; sourceType = $representative.expected.sourceType
                modelPath = $representative.expected.path
            }
            $entry = [ordered]@{
                operation = $operation; sourceShape = $identity; before = $null; target = $null; after = $null
                inMemoryChecks = @(); changed = $false; reopened = $null; reopenChecks = @(); persisted = $false; error = $null
            }
            $shape = $null
            try {
                $shape = Get-ReviewShapeByIdentity $slides $identity
                $before = Get-ReviewShapeSnapshot $shape 0
                $entry.before = Get-ReviewEditValues $before $operation
                $target = [ordered]@{}
                switch ($operation) {
                    'text' {
                        $target.text = if ($before.text -cne 'Edited native text') { 'Edited native text' } else { 'Edited text again' }
                        Set-ReviewShapeText $shape $target.text
                    }
                    'fill' {
                        $target.rgb = $before.fill.rgb -bxor 0xFFFFFF
                        $target.fillType = 1; $target.fillVisible = -1; $target.transparency = 0.0
                        Set-ReviewShapeFill $shape $target.rgb
                    }
                    'position' {
                        $dx = if ($before.bounds.x + $before.bounds.width + 12 -le 1280) { 12 } else { -12 }
                        $dy = if ($before.bounds.y + $before.bounds.height + 4 -le 720) { 4 } else { -4 }
                        $target.x = $before.bounds.x + $dx; $target.y = $before.bounds.y + $dy
                        $shape.Left = $target.x * 0.75; $shape.Top = $target.y * 0.75
                    }
                    'image' {
                        $target.cropLeftPoints = $before.pictureFormat.cropLeftPoints + [Math]::Min(3.0, [double]($before.bounds.width * 0.75 * 0.05))
                        $picture = $null
                        try { $picture = $shape.PictureFormat; $picture.CropLeft = $target.cropLeftPoints }
                        finally { Release-ReviewComObject $picture }
                    }
                    'table' {
                        $oldCell = $before.table.rows[0].cells[0]
                        $target.text = if ($oldCell.text -cne 'EDITED') { 'EDITED' } else { 'EDITED2' }
                        $target.rgb = $oldCell.fill.rgb -bxor 0xFFFFFF
                        $target.fillType = 1; $target.fillVisible = -1; $target.transparency = 0.0
                        $table = $null; $cell = $null; $cellShape = $null
                        try {
                            $table = $shape.Table; $cell = $table.Cell(1, 1); $cellShape = $cell.Shape
                            Set-ReviewShapeText $cellShape $target.text
                            Set-ReviewShapeFill $cellShape $target.rgb
                        } finally { Release-ReviewComObject $cellShape; Release-ReviewComObject $cell; Release-ReviewComObject $table }
                    }
                }
                $entry.target = $target
                $entry.after = Get-ReviewEditValues (Get-ReviewShapeSnapshot $shape 0) $operation
                $entry.inMemoryChecks = @(Test-ReviewEditValues $entry.after $target)
                $changeKeys = switch ($operation) {
                    'text' { @('text') }; 'fill' { @('rgb') }; 'position' { @('x', 'y') }
                    'image' { @('cropLeftPoints') }; 'table' { @('text', 'rgb') }
                }
                $entry.changed = @($changeKeys | Where-Object { $entry.before[$_] -ceq $entry.after[$_] }).Count -eq 0
                if (-not $entry.changed -or @($entry.inMemoryChecks | Where-Object { -not $_.passed }).Count -gt 0) {
                    throw "Existing $operation object did not retain the requested in-memory change."
                }
            } catch {
                $entry.error = $_.Exception.Message
                $issues.Add("$operation edit failed: $($_.Exception.Message)")
            } finally { Release-ReviewComObject $shape }
            $operations.Add([pscustomobject]$entry)
        }
        $report.inventoryChecks = @(Test-ReviewInventory $slides $Pages 'after-edits-before-save')
        $deck.Save()
        $report.saved = $deck.Saved -eq -1
        Release-ReviewComObject $slides; $slides = $null
        try { Close-ReviewPresentation $deck } finally { $deck = $null }
        $report.copySha256AfterSave = (Get-FileHash -LiteralPath $copy -Algorithm SHA256).Hash
        if (-not $report.saved -or $report.copySha256AfterSave -eq $report.copySha256Before) {
            $issues.Add('The disposable PPTX did not save changed bytes.')
        }
        $reopened = Open-ReviewPresentation $Presentations $copy $true
        $report.reopenedReadOnly = $reopened.ReadOnly -eq -1
        if (-not $report.reopenedReadOnly) { throw 'The saved copy was not reopened read-only.' }
        $reopenedSlides = $reopened.Slides
        $report.inventoryChecks += @(Test-ReviewInventory $reopenedSlides $Pages 'reopened-saved-copy')
        foreach ($entry in $operations) {
            if ($entry.error) { continue }
            $shape = $null
            try {
                $shape = Get-ReviewShapeByIdentity $reopenedSlides $entry.sourceShape
                $entry.reopened = Get-ReviewEditValues (Get-ReviewShapeSnapshot $shape 0) $entry.operation
                $entry.reopenChecks = @(Test-ReviewEditValues $entry.reopened $entry.target)
                $entry.persisted = $entry.changed -and @($entry.reopenChecks | Where-Object { -not $_.passed }).Count -eq 0
                if (-not $entry.persisted) { throw 'The reopened copy did not retain the requested value.' }
            } catch {
                $entry.error = $_.Exception.Message
                $issues.Add("$($entry.operation) reopen failed: $($_.Exception.Message)")
            } finally { Release-ReviewComObject $shape }
        }
        $render = Join-Path $runDirectory 'powerpoint'
        New-Item -ItemType Directory -Path $render | Out-Null
        foreach ($number in @($operations | ForEach-Object { $_.sourceShape.page } | Sort-Object -Unique)) {
            $slide = $reopenedSlides.Item([int]$number)
            try {
                $png = Join-Path $render ('slide-{0:D3}.png' -f $number)
                $slide.Export($png, 'PNG', 1280, 720)
                Assert-ReviewPngSize $png
                $report.outputPngPaths += $png
            } finally { Release-ReviewComObject $slide }
        }
        Release-ReviewComObject $reopenedSlides; $reopenedSlides = $null
        try { Close-ReviewPresentation $reopened } finally { $reopened = $null }
        $report.copySha256AfterReopen = (Get-FileHash -LiteralPath $copy -Algorithm SHA256).Hash
        if ($report.copySha256AfterSave -ne $report.copySha256AfterReopen) { $issues.Add('Read-only reopen changed the edited copy.') }
        if (@($report.inventoryChecks | Where-Object { -not $_.passed }).Count -gt 0) {
            $issues.Add('The editability copy added, removed, or replaced an existing source shape or slide.')
        }
    } catch { $issues.Add($_.Exception.Message) }
    finally {
        Release-ReviewComObject $slides; Release-ReviewComObject $reopenedSlides
        if ($deck) {
            try { Close-ReviewPresentation $deck -DiscardChanges }
            catch { $issues.Add("Closing owned editability copy failed: $($_.Exception.Message)") }
        }
        if ($reopened) {
            try { Close-ReviewPresentation $reopened }
            catch { $issues.Add("Closing owned reopened copy failed: $($_.Exception.Message)") }
        }
        $report.originalSha256After = (Get-FileHash -LiteralPath $Source -Algorithm SHA256).Hash
        $report.originalUnchanged = $report.originalSha256After -eq $SourceSha256
        if (-not $report.originalUnchanged) { $issues.Add('The original PPTX SHA256 changed during disposable-copy proof.') }
    }
    foreach ($required in $report.requiredOperations) {
        if (@($operations | Where-Object { $_.operation -eq $required -and $_.persisted }).Count -ne 1) {
            $issues.Add("Required existing-object operation not proven after save/reopen: $required.")
        }
    }
    $report.operations = @($operations); $report.errors = @($issues)
    $report.measuredChecksPassed = $issues.Count -eq 0
    return [pscustomobject]$report
}
