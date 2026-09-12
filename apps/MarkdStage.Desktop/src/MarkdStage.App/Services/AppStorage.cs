using Windows.Storage;

namespace MarkdStageApp.Services;

internal static class AppStorage
{
    public static string LocalRoot => GetRoot(false);
    public static string TransientRoot => GetRoot(true);

    private static string GetRoot(bool transient)
    {
        try
        {
            return transient ? ApplicationData.Current.TemporaryFolder.Path : ApplicationData.Current.LocalFolder.Path;
        }
        catch (InvalidOperationException)
        {
            var root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "MarkdStageApp", transient ? "Transient" : "Local");
            Directory.CreateDirectory(root);
            return root;
        }
    }
}
