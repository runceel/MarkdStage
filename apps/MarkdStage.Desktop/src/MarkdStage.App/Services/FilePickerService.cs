using Windows.Storage.Pickers;

namespace MarkdStageApp.Services;

internal sealed class FilePickerService
{
    public async Task<string?> PickFolderAsync(nint windowHandle)
    {
        var picker = new FolderPicker { SuggestedStartLocation = PickerLocationId.DocumentsLibrary };
        picker.FileTypeFilter.Add("*");
        WinRT.Interop.InitializeWithWindow.Initialize(picker, windowHandle);
        return (await picker.PickSingleFolderAsync())?.Path;
    }

    public async Task<string?> PickMarkdownAsync(nint windowHandle)
    {
        var picker = new FileOpenPicker
        {
            SuggestedStartLocation = PickerLocationId.DocumentsLibrary,
            ViewMode = PickerViewMode.List,
        };
        picker.FileTypeFilter.Add(".md");
        picker.FileTypeFilter.Add(".markdown");
        WinRT.Interop.InitializeWithWindow.Initialize(picker, windowHandle);

        var file = await picker.PickSingleFileAsync();
        return file?.Path;
    }
}
