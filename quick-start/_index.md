---
title: Quick Start
---

Add colvmn to your site as a submodule:

```
git submodule add https://github.com/stevedekorte/colvmn.git colvmn
```

Make each page a directory with two files. `index.html` is a thin shell:

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="/colvmn/style.css">
<title>My Page</title>
</head>
<body>
<div class="page"></div>
<script src="/colvmn/layout/layout.js" type="module"></script>
</body>
</html>
```

`_index.md` holds the content:

```markdown
---
title: My Page
topTitle: My Site
subtitle: A short tagline for the page.
---
