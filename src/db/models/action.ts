
// import bookshelf from '../bookshelf';

// import GroupUser from './group_user';
// import User from './user';
// import GroupSetting from './group_settings';
// import GroupTag from './group_tag';
// import Group from './group';
// import ActionType from './action_type';

// const ValidationError = require('bookshelf-validate/lib/errors').ValidationError;
// export default bookshelf.Model.extend({
//   tableName: 'action',
//   hasTimestamps: true,
//   idAttribute: 'action_id',

//   group: function() {
//     return this.belongsTo(Group, 'deleted_by_user_id', 'user_id');
    
//   },
//   actionType: function() {
//     return this.hasMany(ActionType, 'action_type_id', 'action_type_id');
//   },
//   creator: function() {
//     return this.belongsTo(User, 'deleted_by_user_id', 'user_id');
//   },
//   deletor: function() {
//     return this.belongsTo(User, 'created_by_user_id', 'user_id');
//   },

//   initialize: function() {
//   },
 
// }, {
 
// });