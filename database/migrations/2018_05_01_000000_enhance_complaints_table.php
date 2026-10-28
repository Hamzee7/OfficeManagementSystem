<?php

use Illuminate\Database\Schema\Blueprint;
use Illuminate\Database\Migrations\Migration;

class EnhanceComplaintsTable extends Migration
{
    public function up()
    {
        Schema::table('complaints', function (Blueprint $table) {
            $table->string('title')->default('')->after('id');
            $table->string('category', 50)->default('Other')->after('complaint');
            $table->string('priority', 20)->default('Medium')->after('category');
            $table->string('status', 20)->default('Open')->after('priority');
            $table->integer('assigned_to')->unsigned()->nullable()->after('user_id');
            $table->timestamp('resolved_at')->nullable();
            $table->foreign('assigned_to')->references('id')->on('users')->onUpdate('cascade')->onDelete('set null');
        });

        Schema::table('complaints', function (Blueprint $table) {
            $table->text('complaint')->change();
        });

        Schema::create('complaint_comments', function (Blueprint $table) {
            $table->increments('id');
            $table->integer('complaint_id')->unsigned();
            $table->integer('user_id')->unsigned();
            $table->text('body');
            $table->timestamps();
            $table->foreign('complaint_id')->references('id')->on('complaints')->onUpdate('cascade')->onDelete('cascade');
            $table->foreign('user_id')->references('id')->on('users')->onUpdate('cascade')->onDelete('cascade');
        });
    }

    public function down()
    {
        Schema::drop('complaint_comments');

        Schema::table('complaints', function (Blueprint $table) {
            $table->dropForeign(['assigned_to']);
            $table->dropColumn(['title', 'category', 'priority', 'status', 'assigned_to', 'resolved_at']);
        });
    }
}
