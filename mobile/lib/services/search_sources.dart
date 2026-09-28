class SearchSource {
  final String title, url;
  const SearchSource(this.title, this.url);
}

class SearchSources {
  final String id, query, retrievedAt;
  final List<SearchSource> sources;
  const SearchSources(this.id, this.query, this.retrievedAt, this.sources);
  static SearchSources? parse(dynamic value) {
    if (value is! Map ||
        value['id'] is! String ||
        value['query'] is! String ||
        value['retrievedAt'] is! String ||
        value['sources'] is! List) {
      return null;
    }
    if ((value['id'] as String).length > 100 || (value['query'] as String).length > 500) return null;
    final sources = <SearchSource>[];
    for (final item in (value['sources'] as List).take(3)) {
      if (item is! Map || item['title'] is! String || item['url'] is! String) continue;
      final title = item['title'] as String, url = item['url'] as String;
      final uri = Uri.tryParse(url);
      if (title.length <= 200 &&
          url.length <= 2048 &&
          uri != null &&
          ['http', 'https'].contains(uri.scheme) &&
          uri.host.isNotEmpty &&
          uri.userInfo.isEmpty) {
        sources.add(SearchSource(title, url));
      }
    }
    return sources.isEmpty ? null : SearchSources(value['id'], value['query'], value['retrievedAt'], sources);
  }
}
