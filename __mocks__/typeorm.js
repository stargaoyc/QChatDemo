const mockRepo = {
  findOneBy: () => Promise.resolve(null),
  save: () => Promise.resolve(true),
  delete: () => Promise.resolve(true),
  find: () => Promise.resolve([]),
  count: () => Promise.resolve(0),
  clear: () => Promise.resolve(),
};

const mockDataSource = {
  isInitialized: false,
  initialize: () => Promise.resolve(true),
  getRepository: () => mockRepo,
  destroy: () => Promise.resolve(true),
};

module.exports = {
  DataSource: class {
    constructor() {
      return mockDataSource;
    }
  },
  mockDataSource,
  mockRepo,
};
