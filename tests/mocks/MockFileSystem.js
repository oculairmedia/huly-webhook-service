/**
 * Mock File System for testing
 * 
 * This mock provides an in-memory implementation of Node's fs.promises API
 */

class MockFileSystem {
  constructor () {
    this.files = new Map();
    this.directories = new Set();
    this.directories.add('/'); // Root directory
  }

  async readFile (path, encoding = 'utf8') {
    if (!this.files.has(path)) {
      const error = new Error(`ENOENT: no such file or directory, open '${path}'`);
      error.code = 'ENOENT';
      error.path = path;
      throw error;
    }
    
    const content = this.files.get(path);
    return encoding === 'utf8' ? content : Buffer.from(content);
  }

  async writeFile (path, data, options = {}) {
    // Ensure parent directory exists
    const dir = this._dirname(path);
    if (!this.directories.has(dir) && dir !== '/') {
      const error = new Error(`ENOENT: no such file or directory, open '${path}'`);
      error.code = 'ENOENT';
      throw error;
    }
    
    this.files.set(path, data.toString());
  }

  async mkdir (path, options = {}) {
    if (options.recursive) {
      // Create all parent directories
      const parts = path.split('/').filter(p => p);
      let currentPath = '';
      
      for (const part of parts) {
        currentPath += '/' + part;
        this.directories.add(currentPath);
      }
    } else {
      // Check parent exists
      const parent = this._dirname(path);
      if (!this.directories.has(parent) && parent !== '/') {
        const error = new Error(`ENOENT: no such file or directory, mkdir '${path}'`);
        error.code = 'ENOENT';
        throw error;
      }
      
      this.directories.add(path);
    }
  }

  async rename (oldPath, newPath) {
    if (!this.files.has(oldPath)) {
      const error = new Error(`ENOENT: no such file or directory, rename '${oldPath}' -> '${newPath}'`);
      error.code = 'ENOENT';
      throw error;
    }
    
    const content = this.files.get(oldPath);
    this.files.delete(oldPath);
    this.files.set(newPath, content);
  }

  async unlink (path) {
    if (!this.files.has(path)) {
      const error = new Error(`ENOENT: no such file or directory, unlink '${path}'`);
      error.code = 'ENOENT';
      throw error;
    }
    
    this.files.delete(path);
  }

  async readdir (path) {
    if (!this.directories.has(path)) {
      const error = new Error(`ENOENT: no such file or directory, scandir '${path}'`);
      error.code = 'ENOENT';
      throw error;
    }
    
    const files = [];
    const pathPrefix = path.endsWith('/') ? path : path + '/';
    
    // Find all files in this directory
    for (const [filePath] of this.files) {
      if (filePath.startsWith(pathPrefix)) {
        const relativePath = filePath.substring(pathPrefix.length);
        if (!relativePath.includes('/')) {
          files.push(relativePath);
        }
      }
    }
    
    // Find all subdirectories
    for (const dir of this.directories) {
      if (dir.startsWith(pathPrefix) && dir !== path) {
        const relativePath = dir.substring(pathPrefix.length);
        if (!relativePath.includes('/')) {
          files.push(relativePath);
        }
      }
    }
    
    return files;
  }

  async stat (path) {
    const exists = this.files.has(path) || this.directories.has(path);
    
    if (!exists) {
      const error = new Error(`ENOENT: no such file or directory, stat '${path}'`);
      error.code = 'ENOENT';
      throw error;
    }
    
    const isFile = this.files.has(path);
    const mtime = new Date();
    
    return {
      isFile: () => isFile,
      isDirectory: () => !isFile,
      mtime,
      size: isFile ? this.files.get(path).length : 0
    };
  }

  // Helper methods

  _dirname (path) {
    const lastSlash = path.lastIndexOf('/');
    return lastSlash <= 0 ? '/' : path.substring(0, lastSlash);
  }

  _basename (path) {
    const lastSlash = path.lastIndexOf('/');
    return lastSlash === -1 ? path : path.substring(lastSlash + 1);
  }

  // Test helper methods

  reset () {
    this.files.clear();
    this.directories.clear();
    this.directories.add('/');
  }

  setFile (path, content) {
    // Ensure parent directories exist
    const dir = this._dirname(path);
    if (dir !== '/') {
      const parts = dir.split('/').filter(p => p);
      let currentPath = '';
      
      for (const part of parts) {
        currentPath += '/' + part;
        this.directories.add(currentPath);
      }
    }
    
    this.files.set(path, content);
  }

  getFile (path) {
    return this.files.get(path);
  }

  hasFile (path) {
    return this.files.has(path);
  }

  hasDirectory (path) {
    return this.directories.has(path);
  }

  getAllFiles () {
    return Array.from(this.files.keys());
  }
}

module.exports = MockFileSystem;